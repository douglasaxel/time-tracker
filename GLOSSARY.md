# time-tracker

Mede o tempo trabalhado em cada projeto com o Claude Code, para cobrar horas de clientes.

## Medição

**Projeto**:
A pasta onde uma sessão trabalha: o project root dela, ou o repositório original quando a sessão roda num worktree.
_Avoid_: repositório, workspace, pasta de trabalho

**Tempo trabalhado**:
O tempo em que uma sessão está ativa num projeto, contado uma vez só mesmo com várias sessões abertas no mesmo projeto.
_Avoid_: tempo de sessão, horas abertas

**Atividade**:
Um período em que o Claude responde, um trabalho em background da sessão roda, ou uma pausa curta liga duas interações.
_Avoid_: uso, interação

**Pausa curta**:
Um intervalo entre duas interações que não passa do limite de inatividade e por isso conta como tempo trabalhado.
_Avoid_: ociosidade, idle

**Limite de inatividade**:
O maior intervalo entre interações que ainda conta como tempo trabalhado.
_Avoid_: timeout

**Pausa manual**:
Um período em que a pessoa desligou a contagem de uma sessão, até ela retomar.
_Avoid_: suspensão, stop

## Registro

**Dia**:
A unidade em que o tempo trabalhado de um projeto é guardado, no fuso local.

**Correção**:
Um ajuste manual no tempo de um projeto num dia, seja apagar o dia ou somar e subtrair minutos. Fica marcada na tabela copiada.
_Avoid_: edição, override

## Painel

**Árvore**:
As pastas do disco que contêm projetos, com sequências de pasta única recolhidas num nó só.

**Total da pasta**:
O tempo trabalhado de uma pasta somado ao de todas as pastas dentro dela.
_Avoid_: subtotal, acumulado
