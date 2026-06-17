export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get('roomId') || 'default';
  const id = env.GAME_ROOM.idFromName(roomId);
  const room = env.GAME_ROOM.get(id);
  return room.fetch(request);
}
