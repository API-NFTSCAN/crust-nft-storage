import NFTIterator from '../utils/nftIterator';
import { httpPost, httpGet, sleep, getDirFileNum, padLeftZero } from '../utils/utils';
import { CidProcessInfo, ProcessInfo, NFTItemInfo } from '../types/types';
import Chain from '../chain';
import Ipfs from '../ipfs';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { mkdtemp } from 'fs/promises';
import {
  NFT_LIST_URL,
  NFT_UPDATETOKENURI_URL,
  NFT_UPDATESTATUS_URL,
  NFT_DOWNLOAD_TIMEOUT } from '../consts';
import _colors from 'colors';
import { CID } from 'multiformats/cid';
import { AxiosInstance } from 'axios';

const AsyncLock = require('async-lock')
const cliProgress = require('cli-progress')
const { SingleBar } = require('cli-progress')
const axios = require('axios')
require('events').EventEmitter.defaultMaxListeners = 100;

const lock = new AsyncLock()
const ipfsLock = 'ipfsLock'
const orderLock = 'orderLock'
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
  private failedItems: NFTItemInfo[]
  private cidProcessInfo: CidProcessInfo
  private orderSizeLimit: number
  private orderNumLimit: number
  private stop: boolean
  private axiosInst: AxiosInstance

  constructor() {
    this.ipfs = new Ipfs()
    this.chain = new Chain()

    // Initialize private data
    this.cidProcessInfo = {} as CidProcessInfo
    this.processInfo = {} as ProcessInfo

    this.orderNumLimit = orderNumDefault
    this.orderSizeLimit = orderSizeDefault
    this.processBar = {}
    this.processNum = 0
    this.failedItems = []
    this.stop = false
    this.axiosInst = axios.create()
  }

  async init() {
    // Start IPFS
    await this.ipfs.startIPFS()

    this.initProcessInfo()
  }

  private async initCidInfo() {
    const root = await this.ipfs.objectNew()
    this.cidProcessInfo = {
      root: root,
      cidNum: 0
    }
  }

  private initProcessInfo() {
    this.processInfo = {
      address: '',
      total: 0,
      complete: 0,
      success: 0,
      remaining: 0,
      completeOrder: []
    }
  }

  private initOrderParameters() {
    this.orderNumLimit = orderNumDefault
    this.orderSizeLimit = orderSizeDefault
  }

  private refreshProgress(fileName: string) {
    this.processNum++
    this.processBar.update(this.processNum, {filename: fileName});
    this.processInfo.complete = this.processNum
    this.processInfo.remaining = this.processInfo.total - this.processNum
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
      let getRes = await httpGet(`${NFT_LIST_URL}?nft_address=${address}&page_index=1&page_size=1`)
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
      this.processInfo.remaining = nftNum

      // Process
      this.processNum = 0
      await this.initCidInfo()

      let itemIter = new NFTIterator(NFT_LIST_URL, address, this.orderNumLimit)
      while(await itemIter.hasNext() && !this.stop) {
        const items = await itemIter.nextUrls()
        await this._doProcess(items)
      }

      // Deal with failed
      await this.dealWithRest()

      this.chain.disconnect()

    } catch(e: any) {
      //console.error(e.message)
    } finally {
      this.processBar.stop()
      let nftStatus = 0
      if (this.processInfo.success === 0) {
        nftStatus = 0
      } else if (this.processInfo.success === this.processInfo.total) {
        nftStatus = 1
      } else if (this.processInfo.success < this.processInfo.total) {
        nftStatus = 2
      }
      let updateRes = await httpPost(`${NFT_UPDATESTATUS_URL}?nft_address=${address}&nft_save_status=${nftStatus}`)
      if (!updateRes.status) {
        console.error('Update nft status failed.')
      }
      console.log(`=> total:${this.processInfo.total}, success:${this.processInfo.success}, failed:${this.processInfo.total - this.processInfo.success}`)
      console.log('=> complete orders:')
      console.log(this.processInfo.completeOrder)
      console.log('=> Deal complete')
      this.failedItems = []
      this.initProcessInfo()
      this.initOrderParameters()
      this.stop = false
    }
  }

  private async _doProcess(items: NFTItemInfo[]) {
    let tryout = 3
    let failedArray: NFTItemInfo[] = []
    let tasks = []
    while (true) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        tasks.push(this.getTask(item))
        if (tasks.length === maxDownloadNum || i === items.length - 1) {
          await Promise.all(tasks).then((items: any) => {
            for (const item of items) {
              if (item !== '')
                failedArray.push(item)
            }
          }).catch((e: any) => {})
          tasks = []
        }
      }
      if (failedArray.length === 0 || --tryout <= 0) {
        break
      }
      items = failedArray
      failedArray = []
    }
    Array.prototype.push.apply(this.failedItems, failedArray)
  }

  private getTask(item: NFTItemInfo) {
    const that = this
    return new Promise(async (resolve, reject) => {
      let onRes = false
      let cid = ''
      const link = item.link
      if (link.startsWith("http")) {
        cid = await that.getCidFromUrl(item)
      } else if (link.startsWith("Qm")) {
        cid = link
      } else {
        that.refreshProgress(link)
        onRes = true
      }
      if (cid !== '') {
        onRes = await that.addAndOrder({
          id: item.id,
          link: cid
        })
        onRes = true
      }
      onRes ? resolve('') : resolve(item)
    })
  }

  private async getCidFromUrl(item: NFTItemInfo) {
    try {
      const res = await this.axiosInst.get(item.link, {
        timeout : NFT_DOWNLOAD_TIMEOUT,
        responseType: 'arraybuffer'
      })
      if (res.status === 200) {
        const { cid } = await this.ipfs.add(item.id, res.data)
        return cid.toString()
      }
    } catch (e) {
    }
    return ''
  }

  private async addAndOrder(item: NFTItemInfo) {
    let res = false
    try {
      const that = this
      const cid = item.link
      const info = await this.ipfs.objectStat(cid)
      await lock.acquire(ipfsLock, async function() {
        that.refreshProgress(cid)
        const name = padLeftZero(that.cidProcessInfo.cidNum, String(that.orderNumLimit).length) + item.id
        that.cidProcessInfo.root = await that.ipfs.objectPatchAddLink(that.cidProcessInfo.root, cid, name, info.CumulativeSize)
        that.cidProcessInfo.cidNum++
        if (that.cidProcessInfo.cidNum == that.orderNumLimit) {
          const root = that.cidProcessInfo.root.toString()
          const { CumulativeSize } = await that.ipfs.objectStat(root)
          await that.order(root, CumulativeSize, String(that.orderNumLimit).length)
          that.cidProcessInfo.root = await that.ipfs.objectNew()
          that.cidProcessInfo.cidNum = 0
        }
        res = true
      }).catch((e: any) => {
      })
    } catch (e) {
    }
    return res
  }

  private async order(cid: string, size: number, prefixLen = 0) {
    const that = this
    let orderRes = false
    await lock.acquire(orderLock, async function() {
      try {
        const res = await that.chain.order(cid, size)
        if (res) {
          that.processInfo.completeOrder.push(cid)
          let links: NFTItemInfo[] = []
          for (const file of await that.ipfs.ls(cid)) {
            links.push({
              id: file.name.substr(prefixLen),
              link: file.cid.toString()
            })
          }
          orderRes = true
          await that.updateUpstream(links, cid)
        }
      } catch (e: any) {
      }
    }).catch((e: any) => {
    })
    return orderRes
  }

  private async dealWithRest() {
    try {
      // Retry failed items
      if (this.failedItems.length > 0) {
        await this._doProcess(this.failedItems)
      }

      // Order left cids
      if (this.cidProcessInfo.cidNum > 0) {
        const cid = this.cidProcessInfo.root.toString()
        const { CumulativeSize } = await this.ipfs.objectStat(cid)
        await this.order(cid, CumulativeSize)
      }
      await sleep(3000)
    } catch (e: any) {
      console.error(`Deal with left items failed:${e.message}`)
    }
  }

  private async updateUpstream(items: NFTItemInfo[], orderId: string) {
    // Update nft address with Crust network order id. If you want to get a nft's replica,
    // corresponding order id with this nft should be recorded in NFTScan's database
    const orgLen = items.length
    let tasks = []
    let failedArray: NFTItemInfo[] = []
    let tryout = 3
    while (true) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        tasks.push(new Promise(async (resolve, reject) => {
          let res = await httpPost(`${NFT_UPDATETOKENURI_URL}?nft_address=${this.processInfo.address}&nft_token_id=${item.id}&nft_tokenuri=${item.link}$nft_token_order_id=${orderId}`)
          res.status ? resolve('') : resolve(item)
        }).catch((e: any) => {
          failedArray.push(item)
        }))
        if (tasks.length === maxDownloadNum || i === items.length - 1) {
          await Promise.all(tasks).then((values: any) => {
            for (const val of values) {
              if (val !== '') {
                failedArray.push(val)
              }
            }
          })
          tasks = []
        }
      }
      if (failedArray.length === 0 || --tryout <= 0) {
        break
      }
      items = failedArray
      failedArray = []
    }
    this.processInfo.success += orgLen - failedArray.length
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

  stopTask() {
    if (this.processInfo.address !== '') {
      this.stop = true
      return true
    }
    return false
  }
}
