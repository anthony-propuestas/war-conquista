export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  // Modo online: el emparejador vive en una instancia fija.
  const roomId = url.searchParams.get('match') === '1'
    ? '__matchmaker__'
    : (url.searchParams.get('roomId') || 'default');
  const id = env.GAME_ROOM.idFromName(roomId);
  const room = env.GAME_ROOM.get(id);
  return room.fetch(request);
}
