# downloaddoctor

[English](README.md) · Português · [日本語](README.ja.md)

Aquele PDF que não abre é uma página de "sessão expirada". Aquele zip parou em 70%. O instalador não bate com o checksum publicado. O **downloaddoctor** confere sua pasta de downloads e diz quais arquivos estão quebrados, sem abrir, mover nem apagar nada.

```bash
npx @guihakka2/downloaddoctor                     # confere ~/Downloads
npx @guihakka2/downloaddoctor ./releases -r --dupes
npx @guihakka2/downloaddoctor app.zip --sha256 3f1c…
```

- **Downloads incompletos**: `.crdownload`, `.part`, `.partial` e outros arquivos temporários de navegador.
- **Página da web salva no lugar do arquivo**: um `.pdf`/`.zip` que na verdade é HTML (tela de login ou de erro).
- **Zip corrompido ou cortado**: cada arquivo de dentro é descompactado na memória e tem o CRC-32 conferido (também `.docx`, `.xlsx`, `.apk`…).
- **gzip, PDF, PNG e JPEG cortados**: confere o fim do arquivo.
- **Checksum**: usa `SHA256SUMS`, `checksums.txt` ou `arquivo.sha256` na mesma pasta, ou `--sha256`.
- **Duplicados** (`--dupes`): mesmo tamanho e mesmo SHA-256, e mostra quanto espaço dá para liberar.

Só leitura, sem rede, zero dependências. Detalhes em [SECURITY.md](SECURITY.md).
