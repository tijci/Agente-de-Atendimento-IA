const formData = new FormData();
const blob = new Blob([new Uint8Array([0,1,2])], { type: 'audio/ogg' });
formData.append('file', blob, 'audio.ogg');
formData.append('model', 'whisper-large-v3-turbo');
fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer test' },
    body: formData
}).then(r => r.json()).then(console.log).catch(console.error);
