# Arquitetura GitHub Pages: Media Player Local 100% Client-Side

Plano arquitetural detalhado para transformar a aplicação em um site estático hospedado no GitHub Pages, capaz de indexar vídeos do disco rígido do usuário, salvar o progresso em arquivo local sem banco de dados, e processar vídeos e faixas de áudio via WebAssembly.

---

## Decisões Confirmadas & Resumo

> [!IMPORTANT]
> **Decisões confirmadas para o ambiente GitHub Pages:**
> - **Ambiente de Execução:** Frontend estático no GitHub Pages (100% client-side, zero backend Node.js em nuvem).
> - **Acesso a Arquivos e Pastas:** File System Access API (`window.showDirectoryPicker()`), lendo arquivos e estruturas de pastas diretamente do disco do usuário.
> - **Decodificação & Codecs Não Nativos (MKV, EAC3):** `@ffmpeg/ffmpeg` compilado em WebAssembly (WASM) com Web Workers para remuxing e decodificação local.
> - **Persistência Sem Banco de Dados:** Escrita direta no arquivo `library.json` dentro da própria pasta selecionada no disco local, complementada por cache de permissões e handles via IndexedDB.

---

## 1. Visão Geral: Desafios do GitHub Pages vs. Soluções Propostas

O GitHub Pages é uma hospedagem de **arquivos puramente estáticos** (HTML, CSS, JS e assets) servidos via HTTPS. Ele não possui runtime Node.js, não executa processos nativos do sistema operacional (`ffmpeg.exe`, `ffprobe.exe`) e não tem acesso ao sistema de arquivos do computador do usuário por requisições HTTP tradicionais.

Abaixo está a matriz de obstáculos técnicos centrais e as soluções viáveis, 100% gratuitas e sem banco de dados:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MATRIZ DE OBSTÁCULOS & SOLUÇÕES                   │
├────────────────────────────────┬────────────────────────────────────────────┤
│ Obstáculo no GitHub Pages      │ Solução Técnica (100% Client-Side & Grátis)│
├────────────────────────────────┼────────────────────────────────────────────┤
│ 1. Sem Node.js para escanear   │ File System Access API (Chromium / Edge):  │
│    pastas e diretórios locais  │ varredura recursiva de diretórios no browser│
├────────────────────────────────┼────────────────────────────────────────────┤
│ 2. Sem banco de dados ou       │ Escrita direta do `library.json` no disco  │
│    servidor para salvar estado │ com `FileSystemWritableFileStream` +       │
│                                │ cache de permissões do handle em IndexedDB │
├────────────────────────────────┼────────────────────────────────────────────┤
│ 3. Sem binário nativo FFmpeg   │ FFmpeg.wasm executando dentro de           │
│    para probe e remux de MKV   │ Web Workers com threads paralelas          │
├────────────────────────────────┼────────────────────────────────────────────┤
│ 4. Requisito de SharedArray-   │ Service Worker para injetar cabeçalhos     │
│    Buffer para WASM multithread│ COOP (same-origin) e COEP (require-corp)   │
│    (bloqueado no GH Pages)     │ em tempo de execução (`coi-serviceworker`)  │
├────────────────────────────────┼────────────────────────────────────────────┤
│ 5. Custo de CPU ao converter   │ Modo de cópia de stream de vídeo (remux    │
│    vídeos pesados (1080p/4K)   │ sem re-encoding) convertendo apenas áudio  │
│                                │ incompatível para AAC                      │
└────────────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Análise Técnica Profunda dos Obstáculos e Soluções

### Obstáculo 1: Como ler vídeos do computador através de uma página web
- **O Problema:** Por segurança (sandbox), navegadores impedem páginas web de navegar arbitrariamente por caminhos como `C:\Filmes` ou `/media/videos`.
- **A Solução:** **File System Access API** (`window.showDirectoryPicker`).
  - O usuário clica em "Selecionar Pasta de Mídia" uma única vez.
  - O navegador concede um `FileSystemDirectoryHandle`.
  - O app escaneia recursivamente as pastas, extrai nomes de arquivos, detecta padrões de episódios (`S01E02`), cria URLs virtuais em memória (`URL.createObjectURL(file)`) para streaming direto via tag `<video>`.
  - **Compatibilidade:** Suportado nativamente no Google Chrome, Microsoft Edge, Brave, Opera (todos baseados em Chromium). No Firefox e Safari (que não suportam Directory Picker completo), um fallback via `<input type="file" webkitdirectory>` permite ler a árvore de arquivos para a sessão.

### Obstáculo 2: Onde salvar a biblioteca e progresso sem Banco de Dados
- **O Problema:** Não há servidor Node.js para gravar em `/data/library.json` e não há banco de dados SQL/NoSQL remoto.
- **A Solução:** **Persistência Híbrida Local (Arquivo JSON no Disco + IndexedDB)**.
  - **Arquivo no Disco:** A cada alteração relevante (nova mídia escaneada, série renomeada, progresso periódico a cada 5s), o app solicita um handle de escrita (`handle.getFileHandle('library.json', { create: true })`) e grava diretamente o arquivo JSON dentro da própria pasta de mídia.
  - **Permissões Persistentes:** O `FileSystemDirectoryHandle` é serializado e salvo no **IndexedDB** local do navegador. Quando o usuário reabre o site no GitHub Pages, o app recupera a pasta automaticamente solicitando apenas a confirmação rápida de permissão (`queryPermission({ mode: 'readwrite' })`), sem precisar selecionar a pasta novamente.

### Obstáculo 3: Executar FFmpeg para MKVs e Codecs Incompatíveis
- **O Problema:** Navegadores web tocam nativamente contêineres MP4 e WebM com codecs de vídeo H.264/AV1/VP9 e áudio AAC/Opus. Arquivos MKV e áudios comuns em downloads (DTS, Dolby AC3, EAC3) geram erro de tela preta ou vídeo sem som no `<video>`.
- **A Solução:** **FFmpeg.wasm (WebAssembly)**.
  - O binário do FFmpeg é compilado em WebAssembly e carregado via CDN ou hospedado diretamente no repositório do GitHub Pages.
  - Para arquivos incompatíveis, o app lê blocos do arquivo de vídeo usando `file.slice()` e alimenta o FFmpeg virtual no navegador.
  - **Estratégia de Remuxing Rápido:** O vídeo **NÃO** é re-encodado do zero (o que consumiria 100% da CPU e demoraria minutos). Usa-se `-c:v copy -c:a aac -movflags frag_keyframe+empty_moov`. O vídeo mantém seus frames originais intactos e apenas o contêiner (MKV para MP4 fragmentado) e a faixa de áudio são reempacotados instantaneamente, permitindo início de reprodução quase imediato via `MediaSource Extensions` (MSE) ou Blob virtual.

### Obstáculo 4: Requisito de `SharedArrayBuffer` no GitHub Pages
- **O Problema:** O FFmpeg.wasm multithread (que é essencial para performance aceitável de vídeo) exige `SharedArrayBuffer`. Por diretrizes globais de mitigação do bug Spectre, o navegador só libera `SharedArrayBuffer` se a página tiver dois cabeçalhos HTTP:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  No GitHub Pages, não é possível configurar cabeçalhos de resposta HTTP do servidor.
- **A Solução:** **Service Worker de Auto-Isolamento (`coi-serviceworker`)**.
  - O Service Worker intercepta todas as requisições de página e scripts do GitHub Pages e adiciona esses cabeçalhos virtualmente na resposta do navegador.
  - Isso destrava o uso de `SharedArrayBuffer` e permite que o FFmpeg.wasm rode com aceleração multithread em qualquer domínio estático sem custos.

### Obstáculo 5: Extração de Legendas e Faixas de Áudio
- **O Problema:** Arquivos MKV possuem faixas de áudio e legendas embutidas (SubRip, ASS) que o reprodutor HTML5 padrão não lista.
- **A Solução:**
  - Extração de metadados das faixas via comando leve do FFmpeg WASM (`ffprobe` virtual lendo apenas o cabeçalho inicial do arquivo).
  - Extração de faixas de legenda embutidas convertidas para `.vtt` (WebVTT) e injetadas na tag `<track>` do player.
  - Suporte automático a legendas externas `.srt` e `.vtt` que estejam na mesma pasta local do vídeo.

---

## 3. Arquitetura do Sistema e Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ARQUITETURA GITHUB PAGES (100% CLIENT-SIDE)                 │
└─────────────────────────────────────────────────────────────────────────────┘

 [ USUÁRIO / DISCO LOCAL ]
       │
       │ (1. Concessão de Acesso via showDirectoryPicker)
       ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ NAVEGADOR (GitHub Pages - HTTPS)                                          │
 │                                                                           │
 │  ┌─────────────────────────┐         ┌─────────────────────────────────┐  │
 │  │ Service Worker (COOP)   │         │ IndexedDB (Cache Local)         │  │
 │  │ - Desbloqueia WASM      │         │ - Guarda DirectoryHandle        │  │
 │  │ - Cache de Assets PWA   │         │ - Histórico e configurações     │  │
 │  └───────────┬─────────────┘         └────────────────┬────────────────┘  │
 │              │                                        │                   │
 │              ▼                                        ▼                   │
 │  ┌─────────────────────────────────────────────────────────────────────┐  │
 │  │ Aplicação React (Netflix UI)                                        │  │
 │  │  - Navbar, Hero Banner, Linhas de Cards ("Continuar Assistindo")    │  │
 │  │  - Scanner Local de Arquivos & Nomenclatura (S01E02)                │  │
 │  │  - Player de Vídeo com Seleção de Áudio e Legenda                   │  │
 │  └───────────┬────────────────────────────────────────┬────────────────┘  │
 │              │                                        │                   │
 │              ▼                                        ▼                   │
 │   ┌───────────────────────────┐           ┌────────────────────────────┐  │
 │   │ Player Direto (HTML5)     │           │ Web Worker: FFmpeg.wasm    │  │
 │   │ - MP4 / WebM com H.264/AAC│           │ - Demux MKV -> fMP4 / HLS  │  │
 │   │ - Streaming via Blob URL  │           │ - Áudio AC3/DTS -> AAC     │  │
 │   │ - Zero conversão de CPU   │           │ - Extrai legendas para VTT │  │
 │   └───────────────────────────┘           └────────────────────────────┘  │
 │                                                                           │
 └─────────────────────────────────────┬─────────────────────────────────────┘
                                       │
                                       │ (2. Gravação do library.json)
                                       ▼
                     [ /data/library.json NO DISCO LOCAL ]
```

---

## 4. Experiência do Usuário (UX) & Design Visual

1. **Primeiro Acesso no GitHub Pages:**
   - Tela de Boas-Vindas limpa com estética cinematográfica escura (estilo Netflix).
   - Botão de ação único: **"Conectar Pasta de Mídia"**.
   - Mensagem explicativa clara informando que nenhum arquivo é enviado para servidores ou internet: todo o processamento ocorre no próprio computador.
2. **Navegação & Catálogo:**
   - Varredura imediata dos nomes de arquivos com barra de progresso suave.
   - Carregamento automático de pôsteres locais (`folder.jpg`, `poster.jpg`) e identificação de temporadas e episódios.
   - Fileira de "Continuar Assistindo" com cards horizontais e barra de progresso precisa.
3. **Player de Vídeo:**
   - **Vídeos Nativos (MP4/WebM):** Abertura instantânea sem lag.
   - **Vídeos MKV / Áudio Complexo:** Exibição de um indicador discreto "Preparando fluxo de mídia..." enquanto o Web Worker inicia o remux em segundo plano, começando a reprodução em poucos segundos.
   - Menus integrados para troca de faixas de áudio e legendas.

---

## 5. Roteiro de Implementação Sugerido

- **Fase 1: Motor de Acesso ao Sistema de Arquivos (File System API)**
  - Implementar hook e utilitário para `showDirectoryPicker()`, scanner recursivo de extensões (`.mp4`, `.mkv`, `.avi`, `.webm`, `.srt`) e parser de nomes de episódios.
  - Implementar gravação e leitura do arquivo `library.json` direto no diretório.
  - Salvar o handle no IndexedDB para persistência entre recarregamentos de página.

- **Fase 2: Service Worker & Isolamento de Origem**
  - Configurar Service Worker (`coi-serviceworker`) para viabilizar `SharedArrayBuffer` no GitHub Pages.
  - Habilitar manifest PWA para instalação como app no desktop.

- **Fase 3: Player Híbrido (HTML5 Nativo + FFmpeg.wasm)**
  - Integração do pipeline `@ffmpeg/ffmpeg` em Web Worker com estratégia de cópia de stream de vídeo (`-c:v copy`) para início instantâneo.
  - Suporte a extração de legendas embutidas e carregamento de arquivos `.srt` locais adjacentes.

- **Fase 4: Refinamento de Interface & Deploy no GitHub Pages**
  - Configurar workflow do GitHub Actions para build estático do Vite e publicação automática no GitHub Pages.
