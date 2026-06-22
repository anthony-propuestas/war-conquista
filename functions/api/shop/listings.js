export async function onRequest(context) {
  const { env } = context;

  const { results } = await env.DB.prepare(`
    SELECT
      sl.card_def_id,
      cd.name,
      cd.description,
      cd.effect_type,
      cd.effect_value,
      COALESCE(sl.wgt_price, 1) AS wgt_price
    FROM shop_listings sl
    JOIN card_definitions cd ON cd.id = sl.card_def_id
    WHERE sl.is_listed = 1 AND cd.is_active = 1
    ORDER BY sl.listed_at ASC
  `).all();

  return Response.json(results);
}
