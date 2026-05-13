/* BLOCO: CONFIGURAÇÃO DO DESTINO E PACOTE */
/* 
  📌 Explicação do bloco:
  - Definimos a URL da nossa recepção local.
*/
const url = 'http://127.0.0.1:5173/webhook/neppo';
const payloadFalso = {
  event: 'MESSAGE',
  content: { type: 'TEXT', text: 'Quero ver uma cobertura!' },
  component: { contactId: '5511999999999' }
};
/* BLOCO: ENVIO DO PACOTE (A SIMULAÇÃO) */
/* 📌 Disparando o pacote pela rede local.
  - O `fetch` é o carteiro. Pedimos para ele ir via método POST.
  - Transformamos o objeto JavaScript em texto JSON para a viagem.
*/
fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payloadFalso)
})
  /* BLOCO: VERIFICAÇÃO DE RESPOSTA */
  /* 📌 Recebendo o recibo de entrega.
    - Quando o Express validar a triagem, ele responderá "processado".
  */
  .then(resposta => resposta.json())
  .then(dados => console.log('✅ Resposta do Servidor:', dados))
  .catch(erro => console.error('❌ O carteiro tropeçou:', erro));