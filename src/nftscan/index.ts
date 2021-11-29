import UrlIterator from '../utils/urlIterator';
import { httpGet, sleep, getDirFileNum } from '../utils/utils';
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
const maxDownloadNum = 50

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
      dirNum: 0,
      retryMap: new Map<string, boolean>()
    }
    this.ipfs = new Ipfs()
    this.chain = new Chain()
    this.processInfo = {
      address: '',
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
      address: '',
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
      try {
        for (const dir of this.orderQueueInfo.queue) {
          const pinRes = await this.ipfs.pin(dir)
          const { status } = pinRes
          if (status) {
            const { cid } = pinRes
            const { size, num } = pinRes.data
            console.log(`\n=> Ordering cid:${cid}, size:${size} file number:${num}`)
            const orderRes = await this.chain.order(cid, size)
            if (orderRes) {
              this.processInfo.completeOrder.push(cid)
              this.orderQueueInfo.queue.shift()
              console.log(`=> Order successfully`)
            } else {
              const fileNum = await getDirFileNum(dir)
              this.DecProgress(fileNum)
              console.error(`=> Order failed`)
            }
          } else {
            const fileNum = await getDirFileNum(dir)
            this.DecProgress(fileNum)
            console.error(`IPFS pin add dir:'${dir}' failed, please check IPFS`)
          }
          fs.rmSync(dir, { recursive: true, force: true })
        }
      } catch(e: any) {
        console.error(`Unexpected error occur, error message:${e.message}`)
      }
    }
  }

  private DecProgress(progress: number) {
    this.processNum = this.processNum - progress
    if (this.processNum < 0) {
      this.processNum = 0
    }
    this.processBar.update(this.processNum);
    this.processInfo.complete = this.processNum
    this.processInfo.remaining = this.processInfo.total - this.processNum
  }

  private refreshProgress(fileName: string) {
    this.processNum++
    this.processBar.update(this.processNum, {filename: fileName});
    this.processInfo.complete = this.processNum
    this.processInfo.remaining = this.processInfo.total - this.processNum
  }

  private cleanTmpDirs() {
    for (const dir of this.orderQueueInfo.queue) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    this.orderQueueInfo.queue = []
    if (this.orderQueueInfo.dir !== '') {
      fs.rmSync(this.orderQueueInfo.dir, { recursive: true, force: true })
    }
    this.orderQueueInfo.dir = ''
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

  private async _doProcess(urls: string[]) {
    const that = this
    let tryout = (urls.length / maxDownloadNum + 1) * 2
    while (urls.length > 0 && tryout-- > 0) {
      const len = Math.min(maxDownloadNum, urls.length)
      const tmpUrls = urls.splice(0, len)
      let promises = []
      let successArray: number[] = []
      for (let i = 0; i < tmpUrls.length; i++) {
        const url = tmpUrls[i]
        promises.push(new Promise((resolve, reject) => {
          https.get(url, {timeout : httpTimeout}, async function(res: any) {
            const { statusCode } = res
            const fileName = path.basename(url)
            if (statusCode === 200) {
              let recvData: Buffer = Buffer.alloc(0)
              res.on('data', (d: any) => {
                recvData = Buffer.concat([recvData, d], recvData.length + d.length)
              })
              try {
                await new Promise((resolveInner, rejectInner) => {
                  res.on('end', () => {
                    lock.acquire(downloadLock, async function() {
                      const getSuccess = that.orderQueueInfo.retryMap.get(url)
                      if (getSuccess === undefined || !getSuccess) {
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
                        that.refreshProgress(fileName)
                        if (getSuccess !== undefined) {
                          that.orderQueueInfo.retryMap.set(url, true)
                        }
                      }
                      successArray.push(i)
                      resolveInner(true)
                    }).catch(function(e: any) {
                      console.error(`\nLock acquire failed, error message:${e.message}`)
                      rejectInner(false)
                    })
                  })
                })
              } catch (e: any) {
                console.log(`\nWrite file failed, error message:${e.message}`)
              }
            }
            resolve(true)
          }).setTimeout(httpTimeout, () => {
            reject(false)
          }).on('error', (e: any) => {
            //console.error(`\nDownload(url:${url}) failed, will retry later, error message:${e.message}`)
            reject(false)
          })
        }).catch((e: any) => {
          //console.error(`\nDownload(url:${url}) failed, will retry later, error message:${e.message}`)
        }))
      }
      await Promise.all(promises).then((value: any) => {})
      await this.addAndOrder()
      if (successArray.length != tmpUrls.length) {
        successArray.sort((a, b) => b - a).forEach(e => {
          tmpUrls.splice(e, 1)
        })
        Array.prototype.push.apply(urls, tmpUrls)
        tmpUrls.forEach(e => {
          if (!this.orderQueueInfo.retryMap.has(e)) {
            this.orderQueueInfo.retryMap.set(e, false)
          }
        })
      }
    }
    Array.prototype.push.apply(this.failedUrls, urls)
  }

  async doProcess(address: string) {
    try {
      console.log(`=> Dealing with address:${address} with order number limit:${this.orderNumLimit} and order size limit:${this.orderSizeLimit}`)
      this.processInfo.address = address

      // create a new progress bar instance and use shades_classic theme
      this.processBar = new cliProgress.SingleBar({
        format: '=> Process progress |' + _colors.cyan('{bar}') + '| {percentage}% | {filename} | {value}/{total} Files',
        hideCursor: true
      }, cliProgress.Presets.shades_classic);

      // Get metadata
      let getRes = await httpGet(`${baseUrl}?searchValue=${address}&pageIndex=0&pageSize=1`)
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
      this.orderQueueInfo.queue = []
      this.orderQueueInfo.dir = await mkdtemp(`./${storePrefix}`)
      this.orderQueueInfo.dirSize = 0
      this.orderQueueInfo.dirNum = 0
      this.orderQueueInfo.retryMap = new Map<string, boolean>()
      let urlIter = new UrlIterator(baseUrl, address, this.orderNumLimit)
      while(await urlIter.hasNext()) {
        const urls = await urlIter.nextUrls()
        await this._doProcess(urls)
      }

      // Deal with failed
      await this.dealWithRest()

      this.chain.disconnect()

    } catch(e: any) {
      console.error(e.message)
    } finally {
      console.log(`total:${this.processInfo.total}, success:${this.processInfo.complete}, failed:${this.processInfo.remaining}`)
      console.log('=> Deal complete')
      this.failedUrls = []
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
    return this.processInfo.address
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
