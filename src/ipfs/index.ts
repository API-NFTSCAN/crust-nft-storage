import { globSource } from 'ipfs';
import { CID } from 'multiformats/cid';
import { PinFileItem, PinResult, IpfsObjectInfo } from '../types/types';
import * as IPFS from 'ipfs-core'
import { IPFS_TIMEOUT, IPFS_HOMEDIR } from '../consts';

const { create } = require('ipfs-core')
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
    // Support dag-pb and dag-cbor at a minimum
    const loadCodec = (nameOrCode: any) => {
      if (codecs[nameOrCode]) {
        return codecs[nameOrCode]
      }
      throw new Error(`Could not load codec for ${nameOrCode}`)
    }

    // Initialize our IPFS node with the custom repo options
    const node = await create({
      repo: createRepo(IPFS_HOMEDIR, loadCodec, {
        /**
         * IPFS repos store different types of information in separate datastores.
         * Each storage backend can use the same type of datastore or a different one — for example
         * you could store your keys in a levelDB database while everything else is in files.
         * See https://www.npmjs.com/package/interface-datastore for more about datastores.
         */
        root: new FsDatastore(IPFS_HOMEDIR, {
          extension: '.ipfsroot', // Defaults to '', appended to all files
          errorIfExists: false, // If the datastore exists, don't throw an error
          createIfMissing: true // If the datastore doesn't exist yet, create it
        }),
        // blocks is a blockstore, all other backends are datastores - but we can wrap a datastore
        // in an adapter to turn it into a blockstore
        blocks: new BlockstoreDatastoreAdapter(
          new FsDatastore(`${IPFS_HOMEDIR}/blocks`, {
            extension: '.ipfsblock',
            errorIfExists: false,
            createIfMissing: true
          })
        ),
        keys: new FsDatastore(`${IPFS_HOMEDIR}/keys`, {
          extension: '.ipfskey',
          errorIfExists: false,
          createIfMissing: true
        }),
        datastore: new FsDatastore(`${IPFS_HOMEDIR}/datastore`, {
          extension: '.ipfsds',
          errorIfExists: false,
          createIfMissing: true
        }),
        pins: new FsDatastore(`${IPFS_HOMEDIR}/pins`, {
          extension: '.ipfspin',
          errorIfExists: false,
          createIfMissing: true
        })
      }, {
        /**
         * A custom lock can be added here. Or the build in Repo `fs` or `memory` locks can be used.
         * See https://github.com/ipfs/js-ipfs-repo for more details on setting the lock.
         */
        lock: FSLock
      }),

      // This just means we dont try to connect to the network which isn't necessary
      // to demonstrate custom repos
      config: {
        Routing: {
          Type: 'dhtclient'
        }
      }
    })
    //const config = await node.config.getAll()
    //console.log(config)
    //const info = await node.id()
    //console.log(info)
    this.ipfsClient = node
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
