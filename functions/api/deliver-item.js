import { ethers } from 'ethers';
import { getSession } from '../_lib/session.js';

const SHOP_ABI = [
  "event ItemPurchased(address indexed buyer, uint256 indexed itemId, uint256 quantity, uint256 timestamp)"
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

  const { txHash } = body;
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return Response.json({ error: 'txHash inválido' }, { status: 400 });
  }

  // Anti-doble entrega
  const already = await env.DB.prepare(
    'SELECT tx_hash FROM delivered_txs WHERE tx_hash = ?'
  ).bind(txHash).first();
  if (already) return Response.json({ error: 'Transacción ya procesada' }, { status: 409 });

  const user = await env.DB.prepare(
    'SELECT id, wallet_address FROM users WHERE sub = ?'
  ).bind(session.sub).first();
  if (!user?.wallet_address) {
    return Response.json({ error: 'Wallet no vinculada' }, { status: 400 });
  }

  // Verificar tx en Base
  let itemId, quantity;
  try {
    const provider = new ethers.JsonRpcProvider(env.BASE_RPC_URL);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return Response.json({ error: 'Transacción no encontrada' }, { status: 404 });
    if (receipt.status !== 1) return Response.json({ error: 'Transacción fallida' }, { status: 400 });
    if (receipt.to?.toLowerCase() !== env.SHOP_CONTRACT.toLowerCase()) {
      return Response.json({ error: 'Transacción no es del contrato de tienda' }, { status: 400 });
    }

    const iface = new ethers.Interface(SHOP_ABI);
    const shopAddress = env.SHOP_CONTRACT.toLowerCase();
    let parsed;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== shopAddress) continue;
      try {
        parsed = iface.parseLog(log);
        break;
      } catch { /* continúa */ }
    }

    if (!parsed || parsed.name !== 'ItemPurchased') {
      return Response.json({ error: 'Evento ItemPurchased no encontrado en la tx' }, { status: 400 });
    }

    const buyer = parsed.args[0];
    if (buyer.toLowerCase() !== user.wallet_address.toLowerCase()) {
      return Response.json({ error: 'La tx no pertenece a tu wallet' }, { status: 403 });
    }

    itemId = Number(parsed.args[1]);
    quantity = Number(parsed.args[2]);
  } catch (err) {
    console.error('rpc error', err);
    return Response.json({ error: 'Error al verificar tx en Base' }, { status: 500 });
  }

  // Buscar card_def_id (itemId == card_def_id por diseño)
  const cardDef = await env.DB.prepare(
    'SELECT id FROM card_definitions WHERE id = ? AND is_active = 1'
  ).bind(itemId).first();
  if (!cardDef) return Response.json({ error: 'Item no reconocido en D1' }, { status: 400 });

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO user_shop_items (user_id, card_def_id, quantity, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, card_def_id) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        updated_at = excluded.updated_at
    `).bind(user.id, itemId, quantity, now),
    env.DB.prepare(
      'INSERT INTO delivered_txs (tx_hash, user_id, delivered_at) VALUES (?, ?, ?)'
    ).bind(txHash, user.id, now),
  ]);

  return Response.json({ ok: true, itemId, quantity });
}
