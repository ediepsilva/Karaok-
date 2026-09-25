# Identidade visual — Edie Music Show

Esta pasta é onde o `electron-builder` procura os ícones do app por convenção. **Nenhum ícone foi
gerado ainda** (de propósito: não fabricamos um logo/ícone só para preencher espaço). Enquanto
estiver vazia, o build usa o ícone padrão do Electron — funciona, só não tem a marca.

## O que colocar aqui, quando houver a arte final

| Arquivo    | Uso                                                        | Tamanho recomendado                          |
| ---------- | ---------------------------------------------------------- | -------------------------------------------- |
| `icon.ico` | Ícone do executável e do instalador no Windows             | multi-resolução (16 a 256px), formato `.ico` |
| `icon.png` | Fonte de alta resolução (o builder deriva outros tamanhos) | 1024×1024                                    |

## Para ativar

Depois de colocar `build/icon.ico`, adicione em `package.json` → `build.win`:

```json
"win": {
  "target": "dir",
  "icon": "build/icon.ico"
}
```

(Sem essa linha, mesmo com o arquivo aqui, o builder não usa — por isso não foi adicionada agora
com um arquivo que não existe, o que quebraria o build.)

## Logo principal (dentro do app)

Ainda não há um lugar fixo para logo dentro da interface (hoje o nome "EDIE MUSIC SHOW" é só texto
estilizado no cabeçalho, em `src/renderer/src/App.tsx`/`styles.css`). Se/quando houver um arquivo
de logo (SVG de preferência), ele pode entrar em `src/renderer/src/assets/` e ser importado ali.
