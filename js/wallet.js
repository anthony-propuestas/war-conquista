import { BrowserProvider, Contract, formatUnits } from 'ethers';

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

export async function getWGTBalance(contractAddress) {
  if (!provider) throw new Error('Wallet no conectada');
  const abi = ["function balanceOf(address) view returns (uint256)"];
  const contract = new Contract(contractAddress, abi, provider);
  const addr = await getAddress();
  const raw = await contract.balanceOf(addr);
  return formatUnits(raw, 18);
}

export async function approveWGT(contractAddress, spender, amount) {
  if (!signer) throw new Error('Wallet no conectada');
  const abi = ["function approve(address,uint256) returns (bool)"];
  const contract = new Contract(contractAddress, abi, signer);
  const tx = await contract.approve(spender, amount);
  return tx.wait();
}

export async function buyShopItem(shopAddress, itemId) {
  if (!signer) throw new Error('Wallet no conectada');
  const abi = ["function buyItem(uint256) external"];
  const contract = new Contract(shopAddress, abi, signer);
  const tx = await contract.buyItem(itemId);
  return tx.wait();
}
