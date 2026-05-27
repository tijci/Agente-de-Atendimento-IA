import { extractPortalUrl } from './portal-scraper';


export class MessageTranslator {
    async translate(payload: any): Promise<string> {
        const text = payload.message || '';
        const isAudio = text.includes('.oga') || text.includes('.ogg') || text.includes('.mp3') || payload.contentType === 'AUDIO' || payload.type === 'AUDIO';
        const isImage = text.includes('.jpg') || text.includes('.png') || text.includes('.webp');
        if (isAudio) return await this.transcribeAudio(text);
        if (isImage) return `[FOTO ENVIADA PELO CLIENTE] O cliente enviou uma foto para busca de imóveis visualmente semelhantes no catálogo. Use a ferramenta de busca de imóveis passando esta URL exatamente no parâmetro 'foto_url': ${text}`;
       
        const portalUrl = extractPortalUrl(text);
        if (portalUrl) {
            return (
            `[LINK DE PORTAL IMOBILIÁRIO] O cliente enviou este link de anúncio: ${portalUrl}\n` +
            `Use a ferramenta buscar_imoveis passando esta URL no parâmetro 'link_url'. ` +
            `Não peça código nem informações adicionais — execute a busca diretamente.`
        );
        }
        return text;

    }

    private async transcribeAudio(url: string): Promise<string> {
        try {
            console.log('🎧 Baixando áudio do cliente para transcrição...');
            const audioResponse = await fetch(url);
            if (!audioResponse.ok) throw new Error('Falha no download do áudio');
            const arrayBuffer = await audioResponse.arrayBuffer();

            const formData = new FormData();
            const blob = new Blob([arrayBuffer], { type: 'audio/ogg' });
            const dicionario = "Júlio Casas Imobiliária, Sorocaba, Votorantim, Campolim, Mangal, Trujillo, Éden, Wanel Ville";
            formData.append('prompt', dicionario);
            formData.append('file', blob, 'audio.ogg');
            formData.append('model', 'whisper-large-v3-turbo');

            const aiResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
                body: formData as any
            });

            const data = await aiResponse.json();
            if (data.error) {
                console.error('❌ Erro retornado pela Groq:', data.error);
                return `[FALHA DE ÁUDIO] Erro da API: ${data.error.message || 'Desconhecido'}`;
            }
            return `[ÁUDIO DO CLIENTE]: "${data.text}"`;

        } catch (error) {
            console.error('❌ Falha ao transcrever áudio', error);
            return `[FALHA DE ÁUDIO] Link: ${url}`;
        }
    }


}

export const translator = new MessageTranslator();
