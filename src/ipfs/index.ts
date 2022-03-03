import { globSource } from 'ipfs';
import { CID } from 'multiformats/cid';
import { PinFileItem, PinResult, IpfsObjectInfo } from '../types/types';
import * as IPFS from 'ipfs-core'
import { IPFS_TIMEOUT, IPFS_HOMEDIR } from '../consts';
import { create } from 'ipfs-http-client'

const { createRepo } = require('ipfs-repo')
const FSLock = require('ipfs-repo/locks/fs')
const { FsDatastore } = require('datastore-fs')
const { BlockstoreDatastoreAdapter } = require('blockstore-datastore-adapter')
// multiformat codecs to support
const codecs = [
  require('@ipld/dag-pb'),
  require('@ipld/dag-cbor'),
  require('multiformats/codecs/raw')
].reduce((acc, curr) => {
  acc[curr.name] = curr
  acc[curr.code] = curr

  return acc
}, {})

export default class Ipfs {
  private ipfsClient: any;
  private readonly addOption: object = {
    pin: true,
    wrapWithDirectory: true,
    timeout: 3600000
  }
  private readonly globSourceOptions = {
    recursive: true
  }

  async startIPFS() {
    this.ipfsClient = create()
    //const { cid } = await this.ipfsClient.add('Hello world!')
    //console.log(cid)
  }

  async add(path: string, content: Buffer) {
    let res: any
    try {
      let options = {
        timeout: "240s"
      }
      res = await this.ipfsClient.add({
        path: path,
        content: content
      })
    } catch (e: any) {
      throw new Error(`Could not add data, error info:${e.message}`)
    }
    return res
  }

  async pin(dir: string) {
    let uploadFiles = new Map()
    let fileNum = 0
    let dirCid = ''
    let dirSize = 0
    let files: PinFileItem = {}
    let pinRes: PinResult = { 
      cid: dirCid,
      status: false,
      data: {
        size: 0,
        num: 0,
        files: []
      }
    }
    try {
      for await (const file of this.ipfsClient.addAll(globSource(`./${dir}`, '**/*'), this.addOption)) {
        if (file.path === '') {
          dirCid = file.cid.toString()
          dirSize = file.size
        } else {
          files[file.cid.toString()] = {
            path: file.path,
            size: file.size
          }
          fileNum++
        }
      }
      if (fileNum > 0) {
        pinRes = {
          cid: dirCid,
          status: true,
          data: {
            size: dirSize,
            num: fileNum,
            files: files
          }
        }
      }
    } catch(e: any) {
      throw new Error(e.message)
    }
    return pinRes
  }

  async ls(cid: string) {
    let res = []
    try {
      let options = {
        timeout: "240s"
      }
      for await (const file of this.ipfsClient.files.ls(CID.parse(cid), options)) {
        res.push(file)
      }
    } catch(e: any) {
      throw new Error(`Could not ls cid(${cid}), error info:${e.message}`)
    }
    return res
  }

  async objectStat(cid: string) {
    let res: IpfsObjectInfo = {
      CumulativeSize: 0
    }
    try {
      let options = {
        timeout: IPFS_TIMEOUT
      }
      res = await this.ipfsClient.object.stat(CID.parse(cid), options)
    } catch(e: any) {
      throw new Error(`Could not get cid(${cid}), error:${e.message}`)
    }
    return res
  }

  async objectNew() {
    let res: any
    try {
      let options = {
        timeout: IPFS_TIMEOUT
      }
      res = await this.ipfsClient.object.new({
        template: 'unixfs-dir' 
      }, options)
    } catch(e: any) {
      throw new Error(`Could not new empty IPFS object, error:${e.message}`)
    }
    return res
  }

  async objectPatchAddLink(rootCid: CID, cid: string, name: string, size: number) {
    let res: any
    try {
      let options = {
        timeout: IPFS_TIMEOUT
      }
      res = await this.ipfsClient.object.patch.addLink(rootCid, {
        Name: name,
        Tsize: size,
        Hash: CID.parse(cid)
      }, options)
    } catch(e: any) {
      throw new Error(`Could not add link cid(${cid}), error:${e.message}`)
    }
    return res
  }
}
