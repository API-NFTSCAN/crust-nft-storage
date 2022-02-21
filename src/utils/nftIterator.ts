import { httpPost } from './utils';
import { NFTItemInfo } from '../types/types';

export default class NFTIterator {
  private preUrls: NFTItemInfo[];
  private url: string;
  private pageIndex: number;
  private pageSize: number;
  private address: string;
  private readonly pageSizeLimit = 20

  constructor(url: string, address: string, pageSize: number) {
    this.preUrls = []
    this.url = url;
    this.pageIndex = 1;
    this.pageSize = pageSize;
    this.address = address;
  }

  async hasNext(): Promise<boolean> {
    if (this.preUrls.length !== 0 ) {
      return true
    }
    const reqUrl = `${this.url}?nft_address=${this.address}&page_index=${this.pageIndex}&page_size=${this.pageSizeLimit}`
    const getRes = await httpPost(reqUrl)
    if (!getRes.status) {
      console.error(`Request ${reqUrl} failed`)
      return false
    }
    let metaJson = JSON.parse(getRes.data)
    const nftList = metaJson.data.nft_message_list
    if (nftList.length === 0){
      return false
    }
    nftList.forEach((e: any) => {
      this.preUrls.push({
        id: e.nft_asset_id,
        link: e.nft_content_uri
      })
    })
    this.pageIndex++
    return true
  }

  async nextUrls(): Promise<NFTItemInfo[]> {
    let nftUrls = this.preUrls.splice(0, this.pageSize)
    while (nftUrls.length < this.pageSize) {
      const reqUrl = `${this.url}?nft_address=${this.address}&page_index=${this.pageIndex}&page_size=${this.pageSizeLimit}`
      const getRes = await httpPost(reqUrl)
      if (!getRes.status) {
        console.error(`Request ${reqUrl} failed`)
        return []
      }
      let metaJson = JSON.parse(getRes.data)
      const nftList = metaJson.data.nft_message_list
      if (nftList.length === 0){
        break
      }
      nftList.forEach((e: any) => {
        if (nftUrls.length < this.pageSize) {
          nftUrls.push({
            id: e.nft_asset_id,
            link: e.nft_content_uri
          })
        } else {
          this.preUrls.push({
            id: e.nft_asset_id,
            link: e.nft_content_uri
          })
        }
      })
      this.pageIndex++
    }
    return nftUrls
  }
}
