import UrlIterator from '../utils/urlIterator';
import { httpGet, sleep } from '../utils/utils';
import { OrderQueueInfo, ProcessInfo } from '../types/types';
import Chain from '../chain';
import Ipfs from '../ipfs';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { mkdtemp } from 'fs/promises';
import _colors from 'colors';

const AsyncLock = require('async-lock')
const cliProgress = require('cli-progress')
const { SingleBar } = require('cli-progress')

const lock = new AsyncLock()
const downloadLock = 'downloadLock'
const txHash = '0xcdb7c1a6fe7e112210ca548c214f656763e13533'
const baseUrl = 'https://nftscan.com/nftscan/nftSearch'
const storePrefix = 'nft-'
const orderSizeLimitDefault = 5 * 1024 * 1024 * 1024
const orderNumLimitDefault = 100

export default class NFTScan {
  public readonly chain: Chain
  private ipfsInst: Ipfs;
  private processInfo: ProcessInfo
  private processBar: typeof SingleBar
  private processNum: number
  private failedUrls: string[]
  private orderQueueInfo: OrderQueueInfo
  private orderSizeLimit: number
  private orderNumLimit: number

  constructor() {
    this.orderQueueInfo = {
      queue: [],
      dir: '',
      dirSize: 0,
      dirNum: 0
    }
    this.ipfsInst = new Ipfs()
    this.chain = new Chain()
    this.processInfo = {
      tx: '',
      total: 0,
      complete: 0,
      remaining: 0,
      completeOrder: []
    }
    this.orderNumLimit = orderNumLimitDefault
    this.orderSizeLimit = orderSizeLimitDefault
    this.processBar = {}
    this.processNum = 0
    this.failedUrls = []
  }

  async init() {
    // Start IPFS
    await this.ipfsInst.startIPFS()
  }

  private initProcessInfo() {
    this.processInfo = {
      tx: '',
      total: 0,
      complete: 0,
      remaining: 0,
      completeOrder: []
    }
  }

  private async addAndOrder() {
    // Order files on crust network
    if (this.orderQueueInfo.queue.length > 0) {
      console.log(`\n=> start to order`)
      try {
        for (const dir of this.orderQueueInfo.queue) {
          const pinRes = await this.ipfsInst.pin(dir)
          const { status } = pinRes
          if (status) {
            const { cid } = pinRes
            const { size, num } = pinRes.data
            console.log(`=> Ordering cid:${cid}, size:${size} file number:${num}`)
            const orderRes = await this.chain.order(cid, size)
            if (orderRes) {
              this.processInfo.completeOrder.push(cid)
              this.orderQueueInfo.queue.shift()
              console.log(`=> Order successfully`)
            } else {
              console.error(`=> Order failed`)
            }
          }
          fs.rmSync(dir, { recursive: true, force: true })
        }
      } catch(e: any) {
        console.error(`Unexpected error occur, error message:${e.message}`)
      }
    }
  }

  private refreshProgress(fileName: string) {
    this.processNum++
    this.processBar.update(this.processNum, {filename: fileName});
    this.processInfo.complete = this.processNum
    this.processInfo.remaining = this.processInfo.total - this.processNum
  }

  private doDownload(urls: string[]) {
    let promises = []
    const that = this
    for (const url of urls) {
        promises.push(new Promise((resolve, reject) => {
          https.get(url, {timeout: 3600000}, async function(res: any) {
            const { statusCode } = res
            const fileName = path.basename(url)
            if (statusCode === 200 ) {
              let recvData: Buffer = Buffer.alloc(0)
              res.on('data', (d: any) => {
                recvData = Buffer.concat([recvData, d], recvData.length + d.length)
              })
              await new Promise((resolveInner, rejectInner) => {
                res.on('end', () => {
                  lock.acquire(downloadLock, async function() {
                    let recvSize = recvData.length
                    // Check size limit
                    if (that.orderQueueInfo.dirSize + recvSize > that.orderSizeLimit) {
                      that.orderQueueInfo.queue.push(that.orderQueueInfo.dir)
                      that.orderQueueInfo.dir = await mkdtemp(`./${storePrefix}`)
                      that.orderQueueInfo.dirSize = 0
                      that.orderQueueInfo.dirNum = 0
                    }
                    // Push file
                    fs.writeFileSync(`${that.orderQueueInfo.dir}/${fileName}`, recvData)
                    that.orderQueueInfo.dirSize += recvSize
                    that.orderQueueInfo.dirNum++
                    // Check number limit
                    if (that.orderQueueInfo.dirNum >= that.orderNumLimit) {
                      that.orderQueueInfo.queue.push(that.orderQueueInfo.dir)
                      that.orderQueueInfo.dir = await mkdtemp(`./${storePrefix}`)
                      that.orderQueueInfo.dirSize = 0
                      that.orderQueueInfo.dirNum = 0
                    }
                    resolveInner(recvSize)
                  }).catch(function(e: any) {
                    rejectInner(e)
                    console.error(`Lock acquire failed, error message:${e.message}`)
                  })
                })
              })
              resolve(res)
            } else {
              reject(res)
            }
            that.refreshProgress(fileName)
          }).on('error', (e: any) => {
            console.error(`\nDownload failed, will retry later, error message:${e.message}`)
            that.failedUrls.push(url)
            reject(e)
          })
        }).catch((e: any) => {
          // Deal with error
        }))
    }
    return promises
  }

  private async dealWithRest() {
    let tryout = 10
    while (this.failedUrls.length > 0 && tryout-- > 0) {
      const urls =[...this.failedUrls]
      this.failedUrls = []
      const promises = await this.doDownload(urls)
      for (const p of promises) { await p }
      await this.addAndOrder()
    }
    await new Promise((resolve, reject) => {
      const dir =this.orderQueueInfo.dir
      fs.readdir(dir, async (err: any, data: any) => {
        if (!err && data.length !== 0) {
          this.orderQueueInfo.queue.push(dir)
          await this.addAndOrder()
          resolve(data)
        } else {
          fs.rmSync(dir, { recursive: true, force: true })
          reject(err)
        }
      })
    }).catch((e: any) => {})
  }

  async requestProcess(tx: string) {
    try {
      console.log(`=> Dealing with tx:${tx}`)
      this.processInfo.tx = tx

      // create a new progress bar instance and use shades_classic theme
      this.processBar = new cliProgress.SingleBar({
        format: '=> Process progress |' + _colors.cyan('{bar}') + '| {percentage}% | {filename} | {value}/{total} Files',
        hideCursor: true
      }, cliProgress.Presets.shades_classic);

      // Initialize progress bar
      let getRes = await httpGet(`${baseUrl}?searchValue=${tx}&pageIndex=0&pageSize=1`)
      if (!getRes.status) {
        console.error('Request failed, please try again.')
        return
      }

      // Connect to crust chain
      console.log('=> Connecting to chain...')
      await this.chain.connect2Chain()

      let nftJson = JSON.parse(getRes.data)
      let nftNum = nftJson.data.total
      this.processBar.start(nftNum, 0);
      this.processInfo.total = nftNum
      this.processInfo.complete = 0
      this.processInfo.remaining = nftNum

      // Process
      this.processNum = 0
      this.orderQueueInfo.dir = await mkdtemp(`./${storePrefix}`)
      this.orderQueueInfo.dirSize = 0
      this.orderQueueInfo.dirNum = 0
      let urlIter = new UrlIterator(baseUrl, tx, this.orderNumLimit)
      while(await urlIter.hasNext()) {
        const urls = await urlIter.nextUrls()
        const promises = this.doDownload(urls)
        for (const p of promises) { await p }
        await this.addAndOrder()
      }

      // Deal with failed
      await this.dealWithRest()

      this.chain.disconnect()

      console.log('=> Deal complete')
    } catch(e: any) {
      console.error(e.message)
    } finally {
      this.initProcessInfo()
      this.processBar.stop();
    }
  }

  async UpdateUpstream() {
    console.log('=> Updating upstream status...')
  }

  getProcessInfo(): ProcessInfo {
    return JSON.parse(JSON.stringify(this.processInfo))
  }

  getRunningTask(): string {
    return this.processInfo.tx
  }

  setOrderNumLimit(limit: number) {
    this.orderNumLimit = limit
  }

  getOrderNumLimit() {
    return this.orderNumLimit
  }

  setOrderSizeLimit(limit: number) {
    this.orderSizeLimit = limit
  }

  getOrderSizeLimit() {
    return this.orderSizeLimit
  }
}
