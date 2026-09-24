# v1.0.2 — Pacote do rig: um único executável visível

Só o pacote dos simuladores mudou. **O app continua na 1.0.1**, nada a reinstalar na tenant.

## Um `.exe` só

Dois executáveis lado a lado geravam dúvida sobre qual abrir — e abrir o collector na mão causa conflito na porta 4318, impedindo o programa principal de subir. O collector e a config dele foram para `motor\`, com um aviso dentro:

```
HackathonRacing.exe   <- o único que se abre
racing.ini            <- o único que se edita
captura.txt
motor\                <- peças internas, não abrir
```

O supervisor procura o collector em `motor\` primeiro, roda com o diretório de trabalho nessa pasta e guarda ali o pidfile e a fila de reenvio.

## Runtime embutido no 3.13

O executável passa a embutir Python 3.13, alinhado com o 3.13.5 padronizado nas máquinas do parceiro. O `.exe` **não usa o Python instalado no sistema** — é autocontido — mas a troca evita divergência caso alguém inspecione o pacote.

Os scripts `.py` avulsos seguem rodando de 3.9 a 3.14.

## Lembrete de operação

O `racing.ini` é configurado **uma vez por máquina**: só o `rig_id` muda entre os três PCs. O nome do piloto não vai nesse arquivo — cada cliente escreve `Nome Sobrenome [Empresa]` no perfil do Automobilista 2 e o coletor separa sozinho.
