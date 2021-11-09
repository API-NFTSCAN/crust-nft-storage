import { create, globSource } from 'ipfs';
import Ctl from 'ipfsd-ctl';
import { PinFileItem, PinResult } from '../types/types';

export default class Ipfs {
  private ipfsClient: any;
  private readonly addOption: object = {
    pin: true,
    wrapWithDirectory: true,
    timeout: 10000
  }
  private readonly globSourceOptions = {
    recursive: true
  }

  async startIPFS() {
    const ipfsd = await Ctl.createController({
      ipfsHttpModule: require('ipfs-http-client'),
      ipfsBin: require('ipfs').path()
    })
    const id = await ipfsd.api.id()
    this.ipfsClient = ipfsd.api
    console.log('Start IPFS successfully')
    //console.log(id)
  }

  async pin(dir: string) {
    let uploadFiles = new Map()
    let fileNum = 0
    let dirCid = ''
    let dirSize = 0
    let files: PinFileItem = {}
    let pinRes: PinResult = { 
      cid: '',
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
    } catch(e) {
      console.error(e)
    }
    return pinRes
  }
}
