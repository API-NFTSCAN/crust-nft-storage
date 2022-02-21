import { CID } from 'multiformats/cid';
export interface HttpRes {
  status: boolean,
  data: string
}

export interface PinFileItem {
  [key: string]: {
    path: string,
    size: number
  }
}

export interface PinResult {
  cid: string,
  status: boolean,
  [data: string]: any
}

export interface IpfsObjectInfo {
  Hash?: CID,
  NumLinks?: number,
  BlockSize?: number,
  LinksSize?: number,
  DataSize?: number,
  CumulativeSize: number
}

export interface ProcessInfo {
  address: string,
  total: number,
  complete: number,
  success: number,
  remaining: number,
  completeOrder: string[]
}

export interface NFTItemInfo {
  id: string,
  link: string
}

export interface CidProcessInfo {
  root: CID,
  cidNum: number
}
