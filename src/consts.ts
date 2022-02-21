// Load env

// eslint-disable-next-line node/no-extraneous-require
require('dotenv').config();

export const SEEDS = process.env.CRUST_SEEDS as string;
export const CHAIN_ADDR = process.env.CHAIN_ADDR as string;
export const SERVER_PORT = parseInt(process.env.SERVER_PORT as string);
export const NFT_LIST_URL = process.env.NFT_LIST_URL as string;
export const NFT_UPDATETOKENURI_URL = process.env.NFT_UPDATETOKENURI_URL as string;
export const NFT_UPDATESTATUS_URL = process.env.NFT_UPDATESTATUS_URL as string;
export const NFT_DOWNLOAD_TIMEOUT = parseInt(process.env.NFT_DOWNLOAD_TIMEOUT as string);
export const IPFS_TIMEOUT = process.env.IPFS_TIMEOUT as string;
export const IPFS_HOMEDIR = process.env.IPFS_HOMEDIR as string;
export const HTTP_TIMEOUT:number = 600000
