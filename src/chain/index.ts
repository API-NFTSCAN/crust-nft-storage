import { ApiPromise, WsProvider } from '@polkadot/api';
import { typesBundleForPolkadot, types } from '@crustio/type-definitions';
import { checkCid, checkSeeds, sendTx, sleep } from '../utils/utils';
import { chainAddr, seeds } from '../consts'

export default class Chain {
  private chainApi: any

  async connect2Chain() {
    // Try to connect to Crust Chain
    this.chainApi = new ApiPromise({
      provider: new WsProvider(chainAddr),
      typesBundle: typesBundleForPolkadot
    });
    await this.chainApi.isReadyOrError;
  }

  disconnect() {
    this.chainApi.disconnect()
  }

  async order(cid: string, size: number) {
    // Check cid and seeds
    if (!checkCid(cid)) {
      throw new Error(`Illegal cid:'${cid}'`);
    }
    if (!checkSeeds(seeds)) {
      throw new Error('Illegal seeds');
    }

    // Construct tx
    let txRes: any
    let tryout = 0
    while (tryout++ < 10) {
      const tx = this.chainApi.tx.market.placeStorageOrder(cid, size, 0, '');

      // Send tx and disconnect chain
      try {
        txRes = await sendTx(tx, seeds);
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
