export interface HttpGetRes {
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

export interface ProcessInfo {
  tx: string,
  total: number,
  complete: number,
  remaining: number,
  completeOrder: string[]
}

export interface OrderQueueInfo {
  queue: string[],
  dir: string,
  dirSize: number,
  dirNum: number
}
