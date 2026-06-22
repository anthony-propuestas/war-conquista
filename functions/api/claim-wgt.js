import { ethers } from 'ethers';
import { getSession } from '../_lib/session.js';

const WGT_ABI = [
  "function mint(address to, uint256 amount) external"
];

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) return Response.json({ error: 'No autenticado' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { signature, timestamp } = body;
  if (!signature || !timestamp) {
    return Response.json({ error: 'Faltan signature y timestamp' }, { status: 400 });
  }

  // Firma válida solo 5 minutos
  if (Date.now() - timestamp > 5 * 60 * 1000) {
    return Response.json({ error: 'Firma expirada' }, { status: 400 });
  }

  const user = await env.DB.prepare(
    'SELECT id, wallet_address FROM users WHERE sub = ?'
  ).bind(session.sub).first();

  if (!user?.wallet_address) {
    return Response.json({ error: 'Wallet no vinculada' }, { status: 400 });
  }

  // Verificar firma
  const message = `claim-wgt:${user.id}:${timestamp}`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return Response.json({ error: 'Firma inválida' }, { status: 400 });
  }

  if (recovered.toLowerCase() !== user.wallet_address.toLowerCase()) {
    return Response.json({ error: 'Firma no corresponde a tu wallet' }, { status: 403 });
  }

  // Consultar wins reclamables (meses ya cerrados)
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const rows = await env.DB.prepare(`
    SELECT id, wins FROM user_monthly_wins
    WHERE user_id = ? AND claimed_at IS NULL AND year_month < ?
  `).bind(user.id, currentYearMonth).all();

  const pendingRows = rows.results ?? [];
  const total = pendingRows.reduce((sum, r) => sum + r.wins, 0);

  if (total === 0) {
    return Response.json({ error: 'No hay WGT pendientes (mes actual no cuenta aún)' }, { status: 400 });
  }

  const ids = pendingRows.map(r => r.id);
  const now_ts = Date.now();

  // Marcar como reclamado ANTES del mint (anti doble-mint)
  const placeholders = ids.map(() => '?').join(', ');
  await env.DB.prepare(
    `UPDATE user_monthly_wins SET claimed_at = ? WHERE id IN (${placeholders})`
  ).bind(now_ts, ...ids).run();

  // Mintear en Base
  let txHash;
  try {
    const provider = new ethers.JsonRpcProvider(env.BASE_RPC_URL);
    const wallet = new ethers.Wallet(env.MINTER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(env.WGT_CONTRACT, WGT_ABI, wallet);
    const tx = await contract.mint(user.wallet_address, BigInt(total) * BigInt(1e18));
    await tx.wait();
    txHash = tx.hash;
  } catch (err) {
    // Revertir claimed_at si el mint falló
    await env.DB.prepare(
      `UPDATE user_monthly_wins SET claimed_at = NULL WHERE id IN (${placeholders})`
    ).bind(...ids).run();
    console.error('mint error', err);
    return Response.json({ error: 'Error al mintear WGT, intenta de nuevo' }, { status: 500 });
  }

  return Response.json({ ok: true, amount: total, txHash });
}
