# Hidro PET — lista de presença

Controle de presença das turmas de hidroginástica (terças e quintas; Turma 1 às 16h, Turma 2 às 17h).
Sem login por professor: a equipe toda usa **um código de acesso**. Sem tabelas: todos os dados são um único JSON.

## Publicar na Vercel (plano grátis)

A Vercel não tem disco para guardar arquivos, então os dados ficam no **Upstash Redis** (grátis), ligado ao projeto.

1. **Suba a pasta `hidro-pet`** para um repositório no GitHub (ou use `npx vercel` dentro da pasta).
2. Na Vercel: **Add New → Project** → escolha o repositório. Framework Preset: **Other**. Não precisa de build. Clique em Deploy.
3. Em **Settings → Environment Variables**, crie **`ACCESS_CODE`** (com dois C) com o código da equipe (ex.: uma frase de 8+ caracteres).
4. Em **Deployments**, faça **Redeploy** (as variáveis só valem em novos deploys).
5. Abra o endereço, digite o código, e cadastre professores e alunos. Mande o endereço e o código aos professores.
6. **Recomendado:** aba **Storage** → crie um **Upstash Redis** (plano Free) e conecte ao projeto. Isso cria sozinho as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`; o app aceita as duas formas). Depois, faça Redeploy.

**Sem o Redis, os dados NÃO ficam guardados de forma segura na Vercel.** Eles ficam na pasta temporária de cada instância do servidor: somem quando a instância reinicia (depois de um tempo sem uso) e podem ser diferentes de um celular para outro. Sem Redis, use o app só para testar, ou baixe uma cópia (aba Equipe) com frequência.

Se faltar o `ACCESS_CODE`, o app mostra um aviso e não expõe dados.

## Como funciona
- **Código de acesso:** digitado uma vez por aparelho (fica lembrado por 180 dias). Para trocar o código, mude `ACCESS_CODE` e faça Redeploy: todos os aparelhos precisarão do novo código. Depois de 10 erros, o IP fica bloqueado por 15 minutos.
- **Dados compartilhados:** todos os celulares leem e gravam o mesmo estado. A tela atualiza a cada 30 segundos (só com o app aberto) e ao tocar em ⟳ na Agenda.
- **Cópias automáticas:** na primeira alteração de cada dia, o sistema guarda o estado de antes (45 dias). Aba Equipe → "Cópias automáticas" → Restaurar. Antes de restaurar, o estado atual é guardado como "Antes da última restauração".
- **Cópia manual:** aba Equipe → "Baixar cópia" gera um arquivo JSON. Recomendado baixar 1 vez por semana e guardar no Drive.

## Atenção
- O plano **Hobby** da Vercel é para uso pessoal/não comercial. Se as aulas são cobradas, confira os termos da Vercel (o plano Pro é pago).
- Quem tiver o endereço **e** o código vê nomes e WhatsApp dos alunos. Compartilhe o código só com a equipe.

## Rodar no seu computador (sem Vercel)
1. Instale o Node.js 18 ou mais novo.
2. Dê dois cliques em `iniciar.bat` (ou rode `node server.js`) e abra http://localhost:3000.
3. Os dados ficam em `data/state.json` (cópias diárias em `data/backup-AAAA-MM-DD.json`).
4. Para exigir código também aqui: defina a variável `ACCESS_CODE` antes de iniciar.
5. Para celulares na mesma rede Wi-Fi: use `http://IP-DO-COMPUTADOR:3000`.

## Primeiros passos no app
1. **Equipe:** cadastre os professores.
2. **Alunos:** cadastre ou importe (Nome; Turma; WhatsApp).
3. **Agenda:** "Repetir escala" define o professor das terças e quintas de um período.
4. **Chamada:** marque Presente, Ausente ou Justificada e finalize.
5. **Relatórios:** frequência por aluno, impressão e planilha.

## Observações
- Frequência = presenças ÷ (aulas − faltas justificadas). Só chamadas finalizadas contam.
- Alunos sem marcação ao finalizar a chamada viram "ausente".
- Abrir `public/index.html` direto no navegador (sem servidor) funciona em "modo local": dados só naquele aparelho.
