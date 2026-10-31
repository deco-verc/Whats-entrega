# pushinpay_docs - Knowledge Ready

Arquivo preparado para uso em GPT, Claude Project, Codex ou base de conhecimento.

## Indice

1. [Pushinpay Pix Boleto](#pushinpay-pix-boleto)
2. [Pushinpay Pix Boleto Cancelar-Boleto](#pushinpay-pix-boleto-cancelar-boleto)
3. [Pushinpay Pix Boleto Consultar-Boleto-Por-Periodo](#pushinpay-pix-boleto-consultar-boleto-por-periodo)
4. [Pushinpay Pix Boleto Consultar-Boleto](#pushinpay-pix-boleto-consultar-boleto)
5. [Pushinpay Pix Boleto Criar-Boleto](#pushinpay-pix-boleto-criar-boleto)
6. [Pushinpay Pix Boleto Dados-Boleto](#pushinpay-pix-boleto-dados-boleto)
7. [Pushinpay Pix Boleto Gerar-Pdf-Boleto](#pushinpay-pix-boleto-gerar-pdf-boleto)
8. [Pushinpay Pix Conta](#pushinpay-pix-conta)
9. [Pushinpay Pix Conta Obter-Dados](#pushinpay-pix-conta-obter-dados)
10. [Pushinpay Pix Infracao](#pushinpay-pix-infracao)
11. [Pushinpay Pix Infracao Infracao-Busca](#pushinpay-pix-infracao-infracao-busca)
12. [Pushinpay Pix Infracao Infracao-Med](#pushinpay-pix-infracao-infracao-med)
13. [Pushinpay Pix Pix-Recorrente](#pushinpay-pix-pix-recorrente)
14. [Pushinpay Pix Pix-Recorrente Buscar-Pix-Recorrente](#pushinpay-pix-pix-recorrente-buscar-pix-recorrente)
15. [Pushinpay Pix Pix-Recorrente Cancelar-Pix-Recorrente](#pushinpay-pix-pix-recorrente-cancelar-pix-recorrente)
16. [Pushinpay Pix Pix-Recorrente Criar-Pix-Recorrente](#pushinpay-pix-pix-recorrente-criar-pix-recorrente)
17. [Pushinpay Pix Pix](#pushinpay-pix-pix)
18. [Pushinpay Pix Pix Consultar-Pix](#pushinpay-pix-pix-consultar-pix)
19. [Pushinpay Pix Pix Criar-Pix](#pushinpay-pix-pix-criar-pix)
20. [Pushinpay Pix Pix Saque-Pix](#pushinpay-pix-pix-saque-pix)
21. [Pushinpay Pix Reembolso](#pushinpay-pix-reembolso)
22. [Pushinpay Pix Reembolso Realizar-Reembolso](#pushinpay-pix-reembolso-realizar-reembolso)
23. [Pushinpay Pix Saldo](#pushinpay-pix-saldo)
24. [Pushinpay Pix Saldo Balance](#pushinpay-pix-saldo-balance)


---

## Pushinpay Pix Boleto

Source URL: https://app.theneo.io/pushinpay/pix/boleto

# Boleto

Endpoints necessários para integração do boleto.

#### Exemplo da resposta do Webhook:

A resposta será enviada apenas se o campo

estiver configurado nos endpoints informados.**webhook_url**

JSON

```
{
"id" = string,
"value" = number,
"status" = "created" | "paid" | "canceled",
"end_to_end_id" = string,
"payer_name" = string,
"payer_national_registration" = string,
"qr_code" = string,
"digitable_line" = string,
"our_number" = number,
}
```

Was this section helpful?

###### On this page

- Boleto


---

## Pushinpay Pix Boleto Cancelar-Boleto

Source URL: https://app.theneo.io/pushinpay/pix/boleto/cancelar-boleto

# Cancelar Boleto

#### Header Parameters

Authorizationstring Required

Colocar no formato Bearer TOKEN

Acceptstring Required

application/json

Content-Typestring Required

#### Path Parameters

idstring Required

ID do boleto

### Response

200

Object

{ "success": true, "message": "Boleto baixado com sucesso" }

400

Bad Request -- Composição do request inválido

401

Unauthorized -- Chave TOKEN inválida

403

Forbidden -- Apenas administradores

404

Not Found -- Pedido não existe

405

Method Not Allowed -- Método não permitido

406

Not Acceptable -- Formato JSON inválido

410

Gone -- Essa requisição não existe mais

418

I'm a teapot.

429

Too Many Requests -- Muitas requisições em um curto espaço de tempo

500

Internal Server Error -- Favor tente mais tarde

503

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Was this section helpful?

Base URL

Production:

Sandbox:

#### Response


---

## Pushinpay Pix Boleto Consultar-Boleto-Por-Periodo

Source URL: https://app.theneo.io/pushinpay/pix/boleto/consultar-boleto-por-periodo

# Consultar Boleto por Período

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

#### Query Parameters

Data de início

Data final

### Response

[ { "id": "9FAE4...", "value": "10000", "webhook_url": null, "end_to_end_id": null, "payer_name": "João da Silva", "payer_national_registration": null, "link_boleto": "https://...", "link_download": "https://...", "status": "created" | "paid" | "canceled", "qr_code": "0002010...", "digitable_line": "4359000116...", "our_number": "0000056..." } ]

Bad Request -- Composição do request inválido

Unauthorized -- Chave TOKEN inválida

Forbidden -- Apenas administradores

Not Found -- Pedido não existe

Method Not Allowed -- Método não permitido

Not Acceptable -- Formato JSON inválido

Gone -- Essa requisição não existe mais

I'm a teapot.

Too Many Requests -- Muitas requisições em um curto espaço de tempo

Internal Server Error -- Favor tente mais tarde

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Boleto Consultar-Boleto

Source URL: https://app.theneo.io/pushinpay/pix/boleto/consultar-boleto

# Consultar Boleto

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

#### Path Parameters

ID do boleto

### Response

{ "id": "A023...", "value": "1000", "webhook_url": null, "end_to_end_id": null, "payer_name": null, "payer_national_registration": null, "link_boleto": "https://...", "link_download": "https://...", "status": "created" | "paid" | "canceled", "qr_code": "00020101...", "digitable_line": "4359000116...", "our_number": "0000056..." }

Bad Request -- Composição do request inválido

Unauthorized -- Chave TOKEN inválida

Forbidden -- Apenas administradores

Not Found -- Pedido não existe

Method Not Allowed -- Método não permitido

Not Acceptable -- Formato JSON inválido

Gone -- Essa requisição não existe mais

I'm a teapot.

Too Many Requests -- Muitas requisições em um curto espaço de tempo

Internal Server Error -- Favor tente mais tarde

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Boleto Criar-Boleto

Source URL: https://app.theneo.io/pushinpay/pix/boleto/criar-boleto

# Criar Boleto

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

#### Body Parameters

Data de vencimento YYYY-MM-DD

Valor da cobrança em centavos de reais.

Nome do pagador

Documento CPF ou CNPJ do pagador

Email do pagador

Prefixo do telefone do pagador (apenas os dois números do prefixo)

Número de telefone do pagador

CEP de endereço do pagador

Rua do endereço do pagador

Bairro do endereço do pagador

Número de endereço do pagador

Complemento do endereço do pagador

Cidade do endereço do pagador

UF do estado do endereço do pagador

Caso tenha um servidor para receber as informações de pagamento ou estorno informe aqui sua URL, campo pode ser vazio ""

Utilizado para realizar SPLIT para várias contas já cadastradas na PUSHINPAY { "value": 50, "account_id": "9C3XXXXX3A043" }

Show child attributes

### Response

{ "id": "123…", "value": 1000, "webhook_url": null, "end_to_end_id": null, "payer_name": null, "payer_national_registration": null, "link_boleto": "https://…", "link_download": "https://…", "status": "created", "qr_code": "00020101021…", "digitable_line": "4359000…", "our_number": "0000056…" }

{ "error": "Falha ao gerar boleto" }

Unauthorized -- Chave TOKEN inválida

Forbidden -- Apenas administradores

Not Found -- Pedido não existe

Method Not Allowed -- Método não permitido

Not Acceptable -- Formato JSON inválido

Gone -- Essa requisição não existe mais

I'm a teapot.

Too Many Requests -- Muitas requisições em um curto espaço de tempo

Internal Server Error -- Favor tente mais tarde

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Boleto Dados-Boleto

Source URL: https://app.theneo.io/pushinpay/pix/boleto/dados-boleto

# Dados Boleto

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

#### Path Parameters

### Response

{
"id": "A0233...",
"transaction_id": "A0233...",
"account_id": "9F83...",
"your_number": "123",
"our_number": "0000056...",
"type": "BANKSLIP_PIX",
"due_date": "2025-10-22T00:00:00.000000Z",
"amount": "1000",
"payer_name": "teste",
"payer_document": "00000000000",
"payer_email": "[teste@teste.com](mailto:teste@teste.com)",
"payer_phone_prefix": "11",
"payer_phone_number": "111111111",
"payer_address_zipcode": "13482300",
"payer_address_public_place": "Rua Antonio Palermo",
"payer_address_neighborhood": "Parque Residencial Stahlberg",
"payer_address_number": "123",
"payer_address_complement": null,
"payer_address_city": "Limeira",
"payer_address_state": "SP",
"discount_type": "fixed",
"discount_date": null,
"discount_amount": null,
"late_fine_type": "fixed",
"late_fine_date": null,
"late_fine_amount": null,
"late_payment_type": "fixed",
"late_payment_date": null,
"late_payment_amount": null,
"webhook_url": null,
"qr_code": "0002010...",
"bar_code": "43599...",
"digitable_line": "435900...",
"created_at": "2025-10-17T19:57:39.493000Z",
"updated_at": "2025-10-17T19:57:41.863000Z",
"transaction": {
"id": "A02336...",
"status": "created" | "paid" | "canceled",
"original_amount": "1000",
"description": null,
"external_id": "a023...",
"payment_type": "bolepix",
"refunded": "0",
"voided": "0",
"captured": "0",
"deleted_at": null,
"created_at": "2025-10-17T19:57:39.463000Z",
"updated_at": "2025-10-17T19:57:41.843000Z",
"transactions_pix_cash_in_id": "A0233...",
"end_to_end_id": null,
"payer_name": null,
"payer_national_registration": null,
"payer_type": null,
"gateway": "9",
"transactions_bank_slip_id": null,
"transaction_type": "4",
"payment_link_id": null,
"payer_email": null,
"in_infraction": false,
"token_used": null,
"refund_id": null,
"bank_ispb": null,
"end_to_end_refund_id": null,
"is_threeds": false,
"iid": "80..."
},
"account": {
"id": "9F83E...",
"documentNumber": "00000000000000",
"businessName": "Desenvolvimentos Porto",
"contactNumber": "+5511777777777",
"businessEmail": "[teste@teste.com](mailto:teste@teste.com)",
"address": {
"id": 222,
"postalCode": "580...",
"street": "Rua Praia Formosa",
"number": "5",
"addressComplement": null,
"neighborhood": "Mangabeira",
"account_id": "9F83EC...",
"city": "João Pessoa",
"state": "PB",
"approved": true,
"created_at": "2025-07-30T15:32:31.863000Z",
"updated_at": "2025-07-30T15:34:09.827000Z",
"state_id": 15,
"city_id": 2652
}

Bad Request -- Composição do request inválido

Unauthorized -- Chave TOKEN inválida

Forbidden -- Apenas administradores

Not Found -- Pedido não existe

Method Not Allowed -- Método não permitido

Not Acceptable -- Formato JSON inválido

Gone -- Essa requisição não existe mais

I'm a teapot.

Too Many Requests -- Muitas requisições em um curto espaço de tempo

Internal Server Error -- Favor tente mais tarde

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Boleto Gerar-Pdf-Boleto

Source URL: https://app.theneo.io/pushinpay/pix/boleto/gerar-pdf-boleto

# Gerar PDF Boleto

#### Header Parameters

Authorizationstring Required

Colocar no formato Bearer TOKEN

Acceptstring Required

application/json

Content-Typestring Required

#### Path Parameters

idstring Required

ID do boleto

### Response

200

Object

400

Bad Request -- Composição do request inválido

401

Unauthorized -- Chave TOKEN inválida

403

Forbidden -- Apenas administradores

404

Not Found -- Pedido não existe

405

Method Not Allowed -- Método não permitido

406

Not Acceptable -- Formato JSON inválido

410

Gone -- Essa requisição não existe mais

418

I'm a teapot.

429

Too Many Requests -- Muitas requisições em um curto espaço de tempo

500

Internal Server Error -- Favor tente mais tarde

503

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Was this section helpful?

Base URL

Production:

Sandbox:

#### Response


---

## Pushinpay Pix Conta

Source URL: https://app.theneo.io/pushinpay/pix/conta

Search
API explorer
Changelog
Pix
Sections
Criar PIX
Consultar PIX
Saque PIX
Pix Recorrente
Criar Pix Recorrente
Cancelar Pix Recorrente
Buscar Pix Recorrente
Boleto
Criar Boleto
Consultar Boleto
Consultar Boleto por Período
Dados Boleto
Gerar PDF Boleto
Cancelar Boleto
Conta
Obter Dados
Reembolso
Realizar Reembolso
Infração
Infração (MED)
Infração Busca
Saldo
Theme switcher
Endpoints necessários para obter dados de determinada conta.
Was this section helpful?
Yes
No
On this page


---

## Pushinpay Pix Conta Obter-Dados

Source URL: https://app.theneo.io/pushinpay/pix/conta/obter-dados

# Obter Dados

#### Header Parameters

Authorizationstring Required

Colocar no formato Bearer TOKEN

Acceptstring Required

application/json

Content-Typestring Required

#### Body Parameters

idstring Required

ID da cobrança

### Response

200

Object

{
"name": "Icaro",
"documento": "305**06",
"email": "y************

**) *****-8888", "id": "9F83E..." }**

[o@pushinpay.com.br](mailto:o@pushinpay.com.br)", "telefone": "(400

Bad Request -- Composição do request inválido

401

Unauthorized -- Chave TOKEN inválida

403

Forbidden -- Apenas administradores

404

Not Found -- Pedido não existe

405

Method Not Allowed -- Método não permitido

406

Not Acceptable -- Formato JSON inválido

410

Gone -- Essa requisição não existe mais

418

I'm a teapot.

429

Too Many Requests -- Muitas requisições em um curto espaço de tempo

500

Internal Server Error -- Favor tente mais tarde

503

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Was this section helpful?

Base URL

Production:

Sandbox:

#### Response


---

## Pushinpay Pix Infracao

Source URL: https://app.theneo.io/pushinpay/pix/infracao

Search
API explorer
Changelog
Pix
Sections
Criar PIX
Consultar PIX
Saque PIX
Pix Recorrente
Criar Pix Recorrente
Cancelar Pix Recorrente
Buscar Pix Recorrente
Boleto
Criar Boleto
Consultar Boleto
Consultar Boleto por Período
Dados Boleto
Gerar PDF Boleto
Cancelar Boleto
Conta
Obter Dados
Reembolso
Realizar Reembolso
Infração
Infração (MED)
Infração Busca
Saldo
Theme switcher
Endpoints necessários para responder e visualizar infrações.
Was this section helpful?
Yes
No
On this page


---

## Pushinpay Pix Infracao Infracao-Busca

Source URL: https://app.theneo.io/pushinpay/pix/infracao/infracao-busca

# Infração Busca

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

### Response

{
"data": [
"id": 135,
"created_at": "2026-03-02T18:21:51.627000Z",
"description": null,
"updated_at": "2026-03-02T18:22:43.487000Z",
"transaction": {
"id": "A134A9D0-EC64-432C-AB66-E363123A584A",
"status": "paid",
"value": "2869",
"description": "Pagamento PIX",
"payment_type": "pix",
"created_at": "2026-03-02T18:19:54.137000Z",
"updated_at": "2026-03-02T18:21:51.643000Z",
"webhook_url": null,
"split_rules": [],
"fee": null,
"total": null,
"end_to_end_id": "Eed3d98fe558347cca0eb1233f531ceee",
"payer_name": "Cliente",
"payer_national_registration": "447*********01",
"infraction": {
"defense": "Minha defesa",
"infraction_created": "2026-03-02T18:21:51.627000Z",
"status_text": "Aguardando instituição",
"status": 8,
"analysis_result": null,
"manual_description": "Teste de api de defesa"
}
},
"account_id": "A03CF36B-CB36-4ED7-B7C8-30AF95123CD6",
"account": {
"businessName": "João da Silva",
"email": "[exemplo@pushinpay.com.br](mailto:exemplo@pushinpay.com.br)",
"contactNumber": "+5531971439894"
"origin": 2,
"manual_description": "Teste de api de defesa",
"infraction_defense": null,
"auto_defense_sent": false,
"file": [
"id": 199,
"account_id": "A03CF36B-CB36-4ED7-B7C8-30AF12373CD6",
"infraction_id": "135",
"path": "infractions/A03CF36B-CB36-4ED7-B7C8-301235473CD6/135/a79bae81-8c7d-4091-9157-ee4b88123f84.pdf",
"url": null,
"created_at": "2026-03-02T18:22:42.873000Z",
"updated_at": "2026-03-02T18:22:42.873000Z",
"deleted_at": null,
"url_external": null,
"path_url": "[https://pushinpay-sandbox.s3.us-east-1.amazonaws.com/pushinpay-sandbox/infractions/A03CF36B-CB36-4ED7-B7C8-30AF95473CD6/135/a79bae81-8c7d-4091-9157-ee4b88e2ff84.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIASTHLPGZBYNEFHM6V%2F20260302%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260302T182853Z&X-Amz-SignedHeaders=host&X-Amz-Expires=60&X-Amz-Signature=03bc7b8aa4c350b30bd9601314e1dd8103a1231c4fb9341fd077718d50f3bd57](https://pushinpay-sandbox.s3.us-east-1.amazonaws.com/pushinpay-sandbox/infractions/A03CF36B-CB36-4ED7-B7C8-30AF95473CD6/135/a79bae81-8c7d-4091-9157-ee4b88e2ff84.pdf?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIASTHLPGZBYNEFHM6V%2F20260302%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260302T182853Z&X-Amz-SignedHeaders=host&X-Amz-Expires=60&X-Amz-Signature=03bc7b8aa4c350b30bd9601314e1dd8103a1231c4fb9341fd077718d50f3bd57)"
]

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Infracao Infracao-Med

Source URL: https://app.theneo.io/pushinpay/pix/infracao/infracao-med

# Infração (MED)

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

#### Path Parameters

#### Body Parameters

Arquivos das provas

Show child attributes

Sua defesa

### Response

{ "success": true, "data": { "id": 135, "status": 8, "description": null, "external_id": "A11239D0-EC64-432C-AB66-E36123BA584A", "account_id": "A012336B-CB36-4ED7-B7C8-30AF12373CD6", "transaction_id": "A13123D0-EC64-432C-AB66-E36123BA584A", "created_at": "2026-03-02T18:21:51.627000Z", "updated_at": "2026-03-02T18:22:43.486000Z", "statement_id": null, "analysis_result": null, "gateway": "11", "defense": "Sua defesa", "infraction_created": "2026-03-02T18:21:51.627000Z", "origin": 2, "manual_description": "Teste de api de defesa", "payer_email": null, "payer_phone": null, "admin_id": "11", "auto_defense_sent": false, "compliance_analysis_required": "0", "compliance_analysis_send": null } }

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Pix-Recorrente

Source URL: https://app.theneo.io/pushinpay/pix/pix-recorrente

# Pix Recorrente

Endpoints para realizar cobranças de PIX com recorrência.

→ Gera uma cobrança PIX com recorrência, retornando um**POST /pix/cashIn/subscription****código de pagamento**e um**QR Code**para que o cliente possa efetuar o pagamento.

→ Utilizado para desativar determinada cobrança de PIX recorrente.**DELETE /pix/cashIn/subscription/{id}/cancel**

→ Utilizado para buscar cobranças PIX com recorrência.**GET /pix/cashIn/subscription**

Was this section helpful?

###### On this page

- Pix Recorrente


---

## Pushinpay Pix Pix-Recorrente Buscar-Pix-Recorrente

Source URL: https://app.theneo.io/pushinpay/pix/pix-recorrente/buscar-pix-recorrente

# Buscar Pix Recorrente

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

### Response

{
"data": [
"id": 40123,
"account_id": "9D12365D-3DEB-4271-9E0D-86D2C123D370",
"customer_id": 20014,
"global_id": "UGF5bWVudFN1YnNjcmlwdGlvbjo2OThjNzhmNzNlY123c2RiMWQyNDI4Nzc=",
"correlation_id": "61123421-fe40-4c1c-86ce-241b11235bd",
"value": 200,
"frequency": 2,
"name": "Assinatura Plano",
"comment": "Assinatura Plano",
"pix_recurring_retry_policy": 2,
"status": "ACTIVE",
"created_at": "2026-02-11T12:41:27.380000Z",
"updated_at": "2026-02-11T12:41:27.877000Z",
"webhook_url": "[https://oriented-lamprey-inviting.ngrok-free.app/api](https://oriented-lamprey-inviting.ngrok-free.app/api)",
"subscription_pix_transaction": [
"id": 40024,
"subscription_pix_id": 40123,
"transaction_id": "A1012314-5F5D-4A7F-8277-E7D6123AAC9",
"installment_status": null,
"cobr_status": null,
"cobr_try_status": null,
"created_at": "2026-02-11T12:41:27.397000Z",
"updated_at": "2026-02-11T12:41:27.397000Z",
"installment_number": "1",
"transaction": {
"id": "A1123814-5F5D-4A7F-8277-E7D6123AAC9",
"status": "pending",
"amount": "200",
"original_amount": "200",
"description": "Pagamento PIX Automatico",
"external_id": "6112321-fe40-4c1c-86ce-241b12385bd",
"payment_type": "pix_automatico",
"refunded": "0",
"voided": "0",
"captured": "0",
"deleted_at": null,
"created_at": "2026-02-11T12:41:27.317000Z",
"updated_at": "2026-02-11T12:41:27.903000Z",
"transactions_pix_cash_in_id": "A1123815-3FD4-4FF4-8B65-65B8C1231100",
"end_to_end_id": null,
"payer_name": "João Silva",
"payer_national_registration": "06322593021",
"payer_type": null,
"gateway": "11",
"transactions_bank_slip_id": null,
"transaction_type": "7",
"payment_link_id": null,
"payer_email": null,
"in_infraction": false,
"token_used": null,
"refund_id": null,
"is_threeds": false,
"bank_ispb": null,
"end_to_end_refund_id": null
}
],
"customer": {
"id": 20123,
"external_id": "d31233d-d873-431b-84d1-bb141239edff",
"name": "João Silva",
"email": null,
"phone_number": null,
"document_type": 1,
"document_number": "06322593020",
"created_at": "2026-02-06T16:35:48.587000Z",
"updated_at": "2026-02-06T16:35:48.587000Z",
"anex": null,
"prefer_contact": null,
"status": 1
},
"id": 30017,
"account_id": "9D51235D-3DEB-4271-9E0D-86D2123D370",
"customer_id": 20123,
"global_id": "UGF5bWVudFchYnNjcmlwdG6hbjo2123TkxNTUxMWVmOG4MDM1YjhhZmY=",
"correlation_id": "076123816-3fef-46f8-8db6-5147d1234745",
"created_at": "2026-02-06T16:38:45.023000Z",
"updated_at": "2026-02-06T16:38:45.380000Z",
"id": 30025,
"subscription_pix_id": 30017,
"transaction_id": "A1233E05-AC7A-4B4E-A58A-6A6F123A32E",
"created_at": "2026-02-06T16:38:45.030000Z",
"updated_at": "2026-02-06T16:38:45.030000Z",
"id": "A1123E05-AC7A-4B4E-A58A-6A6F123FA32E",
"external_id": "0767c816-3fef-46f8-8db6-5147dfda4745",
"account_id": "9D5123D-3DEB-4271-9E0D-86D2C0912370",
"created_at": "2026-02-06T16:38:45.003000Z",
"updated_at": "2026-02-06T16:38:45.397000Z",
"transactions_pix_cash_in_id": "A1012306-422C-4BB3-9F3E-9B6123E2748D",
"payer_name": "Maria Santos",
"id": 20078,
"external_id": "d31233d-d873-431b-84d1-bb146123edff",
"name": "Maria Santos",
"links": {
"first": "[http://localhost:8061/api/pix/cashIn/subscription?page=1](http://localhost:8061/api/pix/cashIn/subscription?page=1)",
"last": null,
"prev": null,
"next": "[http://localhost:8061/api/pix/cashIn/subscription?page=2](http://localhost:8061/api/pix/cashIn/subscription?page=2)"
"meta": {
"current_page": 1,
"from": 1,
"path": "[http://localhost:8061/api/pix/cashIn/subscription](http://localhost:8061/api/pix/cashIn/subscription)",
"per_page": 15,
"to": 15

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Pix-Recorrente Cancelar-Pix-Recorrente

Source URL: https://app.theneo.io/pushinpay/pix/pix-recorrente/cancelar-pix-recorrente

# Cancelar Pix Recorrente

#### Header Parameters

Authorizationstring Required

Colocar no formato Bearer TOKEN

Acceptstring Required

application/json

Content-Typestring Required

#### Path Parameters

idstring

### Response

200

Object

{ "success": true, "message": "Assinatura cancelada com sucesso.", "data": { "status": true, "message": "Assinatura cancelada com sucesso.", "data": false } }

Was this section helpful?

Base URL

Production:

Sandbox:

#### Response


---

## Pushinpay Pix Pix-Recorrente Criar-Pix-Recorrente

Source URL: https://app.theneo.io/pushinpay/pix/pix-recorrente/criar-pix-recorrente

# Criar Pix Recorrente

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

#### Body Parameters

Adicione o valor em centavos. O mínimo deve ser 50 centavos

Show child attributes

Caso tenha um servidor para receber as informações de pagamento ou estorno informe aqui sua URL

Adicione o valor em centavos. O valor deve ser inferior ao 'value'

### Response

{
"id": "a10df814-5f5d-4a7f-8277-e7d6906faac9",
"qr_code": "00020101021226810014br.gov.bcb.pix2559qr.woovi.com/qr/v2/cob/7fcb1fca-dcc2-421e-9b8a-6e9a0340dd185204000053039865802BR5909PushinPay6008CAMPINAS62070503***80810014br.gov.bcb.pix2559qr.woovi.com/qr/v2/rec/2345c1b4-1bca-4a…",
"status": "created",
"value": 200,
"webhook_url": "[https://oriented-lamprey-inviting.ngrok-free.app/api](https://oriented-lamprey-inviting.ngrok-free.app/api)",
"qr_code_base64": "Ry95NfG5XD9Vg+/pN8Sls3/wEMRlrpJjzkt5Ge0qCDqCI7Xp/atxTMkSjTp3TZC+jxS821cpl4KCxBgTUTqRiK4uBA+rOruLjiPDgPU3Enn0/Py4wvaA0IrnuHpDMfE/JEguMTd5K+xwkbfpJ9IzyjYftLCaQCDW0x+IdCmu6TRo6inDu9g/gnp1S1YZ9…",
"webhook": null,
"split_rules": [],
"end_to_end_id": null,
"payer_name": "João Silva",
"payer_national_registration": "99999999999",
"subscription_id": "6134421-fe50-4c2f-86ce-2411243385bd"
}

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Pix

Source URL: https://app.theneo.io/pushinpay/pix/pix

# Pix

Endpoints para realizar cobranças via PIX.

→ Gera uma cobrança PIX, retornando um**POST /pix/cashIn****código de pagamento**e um**QR Code**para que o cliente possa efetuar o pagamento.

→ Utilizado para consultar o**GET /transaction/{id}****STATUS**de uma transação PIX.

→ Realiza saque via API.**GET /cashOut**

#### Exemplo da resposta do Webhook:

A resposta será enviada apenas se o campo

estiver configurado nos endpoints informados.**webhook_url**

JSON

```
{
"id" = string,
"value" = number,
"status" = "created" | "paid" | "canceled",
"end_to_end_id" = string,
}
```

Was this section helpful?

###### On this page

- Pix


---

## Pushinpay Pix Pix Consultar-Pix

Source URL: https://app.theneo.io/pushinpay/pix/pix/consultar-pix

# Consultar PIX

#### Header Parameters

Colocar no formato Bearer TOKEN

application/json

#### Path Parameters

### Response

{ "id": "9FF86...", "status": "created" | "paid" | "canceled", "value": "1333", "description": "Pagamento PIX", "payment_type": "pix", "created_at": "2025-09-26T13:15:48.027000Z", "updated_at": "2025-09-26T13:15:48.027000Z", "webhook_url": null, "split_rules": [], "fee": null, "total": null, "end_to_end_id": null, "payer_name": null, "payer_national_registration": null, "webhook": null, "emails": null, "pix_details": { "id": "9FF868...", "expiration_date": "2081-06-23 02:31:34.997", "emv": "00020126850014br.gov.bcb.pix2563pix.pushinpay.com.br/qr/v3/at/b08a3a09-311a-4665-bfaf-8bb2cc5d75a5PUSHIN_PAY_LTDA6007LIMEIRA62070503***63046895", "created_at": "2025-09-26T13:15:48.020000Z", "updated_at": "2025-09-26T13:15:48.020000Z" }, "transaction_product": [] }

se nao encontrado e retornado um []

Base URL

Production:

Sandbox:


---

## Pushinpay Pix Pix Criar-Pix

Source URL: https://app.theneo.io/pushinpay/pix/pix/criar-pix

Esse endpoint cria um código PIX para pagamento.

Pontos de atenção

Tenha sua conta CRIADA e Aprovada.

Para utilização do ambiente SANDBOX fazer o cadastro primeiramente no ambiente de produção (acima) e depois no suporte solicitar a liberação do ambiente SANDBOX;

Valores sempre em CENTAVOS.

Valor mínimo de 50 centavos;

Percentual máximo de 50% para SPLIT entre contas;

Checar o limite de valor máximo em sua conta;

Caso não tenha um servidor para receber as notificações da transação não preencha o campo webhook_url;

Obrigatoriedade de Aviso sobre o Papel da PUSHIN PAY

É de responsabilidade do usuário da plataforma PUSHIN PAY, titular da conta, **informar de maneira clara, destacada e acessível** em seus canais de venda (sites, redes sociais, aplicativos, plataformas, entre outros), que:

**“A PUSHIN PAY atua exclusivamente como processadora de pagamentos e não possui qualquer responsabilidade pela entrega, suporte, conteúdo, qualidade ou cumprimento das obrigações relacionadas aos produtos ou serviços oferecidos pelo vendedor.”**

Esse aviso deve constar **no momento da oferta e antes da finalização do pagamento**, preferencialmente na página de checkout, nos termos de compra e/ou nas comunicações automáticas relacionadas à transação.

O não cumprimento pode gerar penalizações e até bloqueio da conta;

#### Exemplo de Resposta - Endpoint

{
"id": "9c29870c-9f69-4bb6-90d3-2dce9453bb45",
"qr_code": "00020101021226770014BR.GOV.BCB.PIX2555api...",
"status": "created",
"value": 35,
"webhook_url": "http://teste.com",
"qr_code_base64": "data:image/png;base64,iVBORw0KGgoAA.....",
"webhook": null,
"split_rules": [],
"end_to_end_id": null,
"payer_name": null,
"payer_national_registration": null
}

📝 Descrição dos Campos

|
Identificador único da transação gerada. Salve a mesma para consultar o status da mesma. |
Código PIX completo no padrão EMV para ser copiado e pago manualmente. |
Status atual da transação (`created | paid | expired` ). |
Valor da cobrança em centavos de reais. |
URL informada para receber notificações de pagamento. |
Imagem do QR Code no formato base64, ideal para exibição. |
Retorno interno do processamento da notificação enviada, se houver. |
Lista com as regras de divisão de valores (caso existam splits configurados). |
Código identificador do PIX gerado pelo Banco Central (aparece após o pagamento). |
Nome do pagador, retornado após o pagamento. |
`payer_national_registration`
| CPF ou CNPJ do pagador, retornado após o pagamento. |

### Webhook de retorno

Ao adicionar o campo webhook_url na criação do qrcode pix, quando o status for alterados e caso falhe a tentativa nós tentaremos enviar 3x, e caso as 3x falhe, via painel administrativo será possível retomar os envios do mesmo. Também é possível adicionar um header customizado que iremos enviar para você em todos os webhooks, essa configuração está disponível em seu menu de configurações de nosso painel

Não recomendamos a pratica de scrap, por isso atente-se a usar os nossos webhooks para receber alterações de status

**Erros de Limite e Validação**

**Valor acima do limite permitido:** Quando o valor enviado para geração do QR Code PIX ultrapassa o limite máximo configurado na conta , será retornada a mensagem informando o valor máximo permitido ;

**Valor do split maior que o valor total:** Se o valor definido para o split for maior do que o valor total da transação, será retornado um erro indicando que o valor da transação não pode ser menor que o valor do split.

**Split + taxa maior que o valor total:** Quando a soma do valor do split com a taxa de transação for maior que o valor total da transação, o sistema retorna uma mensagem indicando que isso não é permitido.

**Conta de split não encontrada:** Caso o `account_id`

informado em algum dos splits não corresponda a uma conta válida no banco de dados, será exibida uma mensagem de erro informando que a conta não foi encontrada.

**Valor total dos splits excede o valor da transação:** Se a soma dos valores dos splits (incluindo a taxa) for maior que o valor total da transação, um erro será retornado informando que a soma não pode exceder o valor da transação.

**Splits do token inválidos:** A mesma validação anterior se aplica ao caso em que os splits vêm de um token usado na geração da transação. Se os valores forem inconsistentes, o erro indicará que a soma dos splits vinculados ao token não pode exceder o valor da transação.


---

## Pushinpay Pix Pix Saque-Pix

Source URL: https://app.theneo.io/pushinpay/pix/pix/saque-pix

# Saque PIX

#### Header Parameters

Authorizationstring Required

Colocar no formato Bearer TOKEN

Acceptstring Required

application/json

Content-Typestring Required

#### Body Parameters

valuenumber

Valor em centavos de reais

receiver_national_registrationstring

pix_key_typestring

pix_keystring

expires_atstring

webhook_urlstring

devicenumber

### Response

200

Object

{
"id": "a02b0d...",
"end_to_end_id": null,
"receiver_name": null,
"webhook_url": "[https://meusite.com/webhook/pix-status](https://meusite.com/webhook/pix-status)",
"value": 5000,
"status": "created" | "paid" | "canceled",
"receiver_national_registration": "12345678910",
"pix_key_type": "national_registration",
"pix_key": "12345678910",
"webhook": null
}

401

{ "error": "Token inválido ou expirado." }

404

se nao encontrado e retornado um []

Was this section helpful?

Base URL

Production:

Sandbox:

#### Response


---

## Pushinpay Pix Reembolso

Source URL: https://app.theneo.io/pushinpay/pix/reembolso

Search
API explorer
Changelog
Pix
Sections
Criar PIX
Consultar PIX
Saque PIX
Pix Recorrente
Criar Pix Recorrente
Cancelar Pix Recorrente
Buscar Pix Recorrente
Boleto
Criar Boleto
Consultar Boleto
Consultar Boleto por Período
Dados Boleto
Gerar PDF Boleto
Cancelar Boleto
Conta
Obter Dados
Reembolso
Realizar Reembolso
Infração
Infração (MED)
Infração Busca
Saldo
Theme switcher
Endpoints necessários para realizar reembolso.
Was this section helpful?
Yes
No
On this page


---

## Pushinpay Pix Reembolso Realizar-Reembolso

Source URL: https://app.theneo.io/pushinpay/pix/reembolso/realizar-reembolso

# Realizar Reembolso

#### Header Parameters

Authorizationstring Required

Colocar no formato Bearer TOKEN

Acceptstring Required

application/json

Content-Typestring Required

#### Path Parameters

idstring Required

### Response

200

Object

400

Bad Request -- Composição do request inválido

401

Unauthorized -- Chave TOKEN inválida

403

Forbidden -- Apenas administradores

404

Not Found -- Pedido não existe

405

Method Not Allowed -- Método não permitido

406

Not Acceptable -- Formato JSON inválido

410

Gone -- Essa requisição não existe mais

418

I'm a teapot.

429

Too Many Requests -- Muitas requisições em um curto espaço de tempo

500

Internal Server Error -- Favor tente mais tarde

503

Service Unavailable -- Estamos temporariamente inativos, favor aguardar.

Was this section helpful?

Base URL

Production:

Sandbox:

#### Response


---

## Pushinpay Pix Saldo

Source URL: https://app.theneo.io/pushinpay/pix/saldo

Search
API explorer
Changelog
Pix
Sections
Criar PIX
Consultar PIX
Saque PIX
Pix Recorrente
Criar Pix Recorrente
Cancelar Pix Recorrente
Buscar Pix Recorrente
Boleto
Criar Boleto
Consultar Boleto
Consultar Boleto por Período
Dados Boleto
Gerar PDF Boleto
Cancelar Boleto
Conta
Obter Dados
Reembolso
Realizar Reembolso
Infração
Infração (MED)
Infração Busca
Saldo
Theme switcher
Endpoints necessários para visualizar saldo e valores bloqueados.
Was this section helpful?
Yes
No
On this page


---

## Pushinpay Pix Saldo Balance

Source URL: https://app.theneo.io/pushinpay/pix/saldo/balance

# Saldo

#### Header Parameters

Authorizationstring Required

Colocar no formato Bearer TOKEN

Acceptstring Required

application/json

Content-Typestring Required

### Response

200

Object

{ "amount":65439, "blocked_balance":"3634" }

Was this section helpful?

Base URL

Production:

Sandbox:

#### Response
