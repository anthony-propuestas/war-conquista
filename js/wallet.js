import { BrowserProvider, Contract } from 'ethers';

let provider = null;
let signer = null;

export async function connectWallet() {
  if (!window.ethereum) throw new Error('MetaMask no está instalado');
  provider = new BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  signer = await provider.getSigner();
  return signer.getAddress();
}

export function getAddress() {
  if (!signer) return null;
  return signer.getAddress();
}

export function signMessage(message) {
  if (!signer) throw new Error('Wallet no conectada');
  return signer.signMessage(message);
}

export async function mintNFT(contractAddress, abi, tokenURI) {
  if (!signer) throw new Error('Wallet no conectada');
  const contract = new Contract(contractAddress, abi, signer);
  const tx = await contract.mint(await signer.getAddress(), tokenURI);
  return tx.wait();
}

export async function claimReward(contractAddress, abi) {
  if (!signer) throw new Error('Wallet no conectada');
  const contract = new Contract(contractAddress, abi, signer);
  const tx = await contract.claimReward();
  return tx.wait();
}
