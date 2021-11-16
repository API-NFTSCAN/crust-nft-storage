import UrlIterator from '../utils/urlIterator';
import { httpGet, sleep } from '../utils/utils';
import { OrderQueueInfo, ProcessInfo } from '../types/types';
import Chain from '../chain';
import Ipfs from '../ipfs';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { mkdtemp } from 'fs/promises';
import { httpTimeout } from '../consts';
import _colors from 'colors';

const AsyncLock = require('async-lock')
const cliProgress = require('cli-progress')
const { SingleBar } = require('cli-progress')

const lock = new AsyncLock()
const downloadLock = 'downloadLock'
const baseUrl = 'https://nftscan.com/nftscan/nftSearch'
const storePrefix = 'nft-'
const maxDownloadNum = 100

const orderSizeLowerLimit = 100 * 1024 * 1024
const orderSizeUpperLimit = 10 * 1024 * 1024 * 1024
export const orderNumDefault = 500
export const orderSizeDefault = 5 * 1024 * 1024 * 1024

export default class NFTScan {
  public readonly chain: Chain
  private ipfs: Ipfs;
  private processInfo: ProcessInfo
  private processBar: typeof SingleBar
  private processNum: number
  private failedUrls: string[]
  private orderQueueInfo: OrderQueueInfo
  private orderSizeLimit: number
  private orderNumLimit: number

  constructor() {
    // queue: directories ready for order
    // dir: being processed directory
    // dirSize: total size of dir
    // dirNum: total file number of dir
    this.orderQueueInfo = {
      queue: [],
      dir: '',
      dirSize: 0,
      dirNum: 0
    }
    this.ipfs = new Ipfs()
    this.chain = new Chain()
    this.processInfo = {
      tx: '',
      total: 0,
      complete: 0,
      remaining: 0,
      completeOrder: []
    }
    this.orderNumLimit = orderNumDefault
    this.orderSizeLimit = orderSizeDefault
    this.processBar = {}
    this.processNum = 0
    this.failedUrls = []
  }

  async init() {
    // Start IPFS
    await this.ipfs.startIPFS()
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

  private initOrderParameters() {
    this.orderNumLimit = orderNumDefault
    this.orderSizeLimit = orderSizeDefault
  }

  private async addAndOrder() {
    // Order files on crust network
    if (this.orderQueueInfo.queue.length > 0) {
      console.log(`\n=> start to order`)
      try {
        for (const dir of this.orderQueueInfo.queue) {
          const pinRes = await this.ipfs.pin(dir)
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

  private async _doProcess(urls: string[]) {
    const that = this
    let _urls = [...urls]
    let tryout = 10
    while (_urls.length > 0 && tryout-- > 0) {
      const len = Math.min(maxDownloadNum, _urls.length)
      const tmpUrls = _urls.splice(0, len)
      let promises = []
      for (const url of tmpUrls) {
        promises.push(new Promise((resolve, reject) => {
          https.get(url, {timeout: httpTimeout}, async function(res: any) {
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
            _urls.push(url)
            reject(e)
          })
        }).catch((e: any) => {
          // Deal with error
        }))
      }
      for (const p of promises) { await p }
      await this.addAndOrder()
    }
    Array.prototype.push.apply(this.failedUrls, _urls)
  }

  private cleanTmpDirs() {
    for (const dir of this.orderQueueInfo.queue) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    if (this.orderQueueInfo.dir !== '') {
      fs.rmSync(this.orderQueueInfo.dir, { recursive: true, force: true })
    }
  }

  private async dealWithRest() {
    // Try failed urls again
    const promises = await this._doProcess(this.failedUrls)

    // Deal with left directory
    await new Promise((resolve, reject) => {
      const dir =this.orderQueueInfo.dir
      fs.readdir(dir, async (err: any, data: any) => {
        if (!err && data.length !== 0) {
          this.orderQueueInfo.queue.push(dir)
          await this.addAndOrder()
          resolve(data)
        } else {
          fs.rmSync(dir, { recursive: true, force: true })
          this.orderQueueInfo.dir = ''
          reject(err)
        }
      })
    }).catch((e: any) => {})
  }

  async doProcess(tx: string) {
    try {
      console.log(`=> Dealing with tx:${tx}`)
      this.processInfo.tx = tx

      // create a new progress bar instance and use shades_classic theme
      this.processBar = new cliProgress.SingleBar({
        format: '=> Process progress |' + _colors.cyan('{bar}') + '| {percentage}% | {filename} | {value}/{total} Files',
        hideCursor: true
      }, cliProgress.Presets.shades_classic);

      // Get metadata
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
        await this._doProcess(urls)
      }

      // Deal with failed
      await this.dealWithRest()

      this.chain.disconnect()

      console.log('=> Deal complete')
    } catch(e: any) {
      console.error(e.message)
    } finally {
      console.log(`total:${this.processInfo.total}, success:${this.processInfo.complete}, failed:${this.processInfo.remaining}`)
      this.cleanTmpDirs()
      this.initProcessInfo()
      this.initOrderParameters()
      this.processBar.stop();
    }
  }

  async UpdateUpstream() {
    // TODO: Update nft address with Crust network order id. If you want to get a nft's replica,
    // corresponding order id with this nft should be recorded in NFTScan's database
    console.log('=> Updating upstream status...')
  }

  getProcessInfo(): ProcessInfo {
    return JSON.parse(JSON.stringify(this.processInfo))
  }

  getRunningTask(): string {
    return this.processInfo.tx
  }

  setOrderNumLimit(limit: number) {
    if (limit < 1) {
      return ` orderNumLimit should be greater than 1, use default:${orderNumDefault}`
    }
    this.orderNumLimit = limit
    return ''
  }

  getOrderNumLimit() {
    return this.orderNumLimit
  }

  setOrderSizeLimit(limit: number) {
    if (limit < orderSizeLowerLimit || limit > orderSizeUpperLimit) {
      return ` ${limit} is out of range, orderSizeLimit should be in [${orderSizeLowerLimit}, ${orderSizeUpperLimit}], use default:${orderSizeDefault}`
    }
    this.orderSizeLimit = limit
    return ''
  }

  getOrderSizeLimit() {
    return this.orderSizeLimit
  }
}
