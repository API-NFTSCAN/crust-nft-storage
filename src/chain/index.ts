import { ApiPromise, WsProvider } from '@polkadot/api';
import { typesBundleForPolkadot, types } from '@crustio/type-definitions';
import { checkCid, checkSeeds, sendTx, sleep } from '../utils/utils';

export default class Chain {
  private readonly seeds = 'burger proud marine napkin business menu ankle combine diesel eager mushroom culture'
  private chainAddr = 'wss://rpc.crust.network'
  private ipfsGateway = 'https://ipfs.io'
  private chain: any

  async connect2Chain() {
    // Try to connect to Crust Chain
    this.chain = new ApiPromise({
      provider: new WsProvider(this.chainAddr),
      typesBundle: typesBundleForPolkadot
    });
    await this.chain.isReadyOrError;
  }

  disconnect() {
    this.chain.disconnect()
  }

  getChainConfig() {
    return {
      chainAddr: this.chainAddr,
      ipfsGateway: this.ipfsGateway
    }
  }

  setChainAddr(chainAddr: string) {
    this.chainAddr = chainAddr
  }

  setIPFSGateway(ipfsGateway: string) {
    this.ipfsGateway = ipfsGateway
  }

  async order(cid: string, size: number) {
    // Check cid and seeds
    if (!checkCid(cid)) {
      throw new Error(`Illegal cid:'${cid}'`);
    }
    if (!checkSeeds(this.seeds)) {
      throw new Error('Illegal seeds');
    }

    // Get file size by hard code instead of requsting ipfs.gateway(leads timeout)
    // const ipfs = axios.create({
    //     baseURL: ipfsGateway + '/api/v0',
    //     timeout: 60 * 1000, // 1 min
    //     headers: {'Content-Type': 'application/json'},
    // });
    // const res = await ipfs.post(`/object/stat?arg=${cid}`);
    // const objInfo = parseObj(res.data);
    // const size = objInfo.CumulativeSize;
    // console.log(`Got IPFS object size: ${size}`);

    // Construct tx
    let txRes: any
    let tryout = 0
    while (tryout++ < 10) {
      const tx = this.chain.tx.market.placeStorageOrder(cid, size, 0, '');

      // Send tx and disconnect chain
      try {
        txRes = await sendTx(tx, this.seeds);
      } catch(e: any) {
        console.error('Send transaction failed')
      }
      if (txRes) {
        break
      }
      console.log(`Send tx cid:${cid} failed, try again...${tryout}`)
      await sleep(3000)
    }

    return txRes
  }
}
