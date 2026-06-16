export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT username, wins FROM users ORDER BY wins DESC LIMIT 100"
  ).all();

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
