# xcirculars Webhook Server

Servidor Express para recibir webhooks de Meta WhatsApp Business API.

## Características

- ✅ Verificación de webhook según documentación oficial de Meta
- ✅ Recepción de mensajes entrantes (texto, imágenes, audio, documentos, ubicación)
- ✅ Respuestas automáticas básicas
- ✅ Monitoreo de estado de mensajes enviados (delivered, read, failed)
- ✅ Verificación de firma de webhooks (seguridad)
- ✅ Listo para deploy en Render

## Estructura de Webhook

```
POST /webhook
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "BUSINESS_ACCOUNT_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { ... },
        "contacts": [{ "profile": { "name": "Cliente" } }],
        "messages": [{ "from": "5215512345678", "type": "text", ... }]
      },
      "field": "messages"
    }]
  }]
}
```

## Deploy en Render

### 1. Crear cuenta en Render
- Ve a https://render.com
- Regístrate con GitHub

### 2. Crear Web Service
- **Build Command:** `npm install`
- **Start Command:** `npm start`

### 3. Variables de Entorno
En el panel de Render, agrega:

| Variable | Valor |
|----------|-------|
| `VERIFY_TOKEN` | `xcirculars_webhook_verify_2026` |
| `WHATSAPP_TOKEN` | `EAAaxwNTNd68B...` (tu token de Meta) |
| `PHONE_NUMBER_ID` | `981887568348921` |

### 4. Obtener URL
Una vez deployado, Render te dará una URL como:
```
https://xcirculars-webhook.onrender.com
```

## Configuración en Meta Developer Console

### 1. Ir a tu App de WhatsApp
https://developers.facebook.com/apps/[TU_APP_ID]/whatsapp-business/webhooks/

### 2. Configurar Webhook
- **Callback URL:** `https://xcirculars-webhook.onrender.com/webhook`
- **Verify Token:** `xcirculars_webhook_verify_2026`

### 3. Suscribirse a Eventos
Marca los campos:
- ✅ `messages` (para recibir mensajes)
- ✅ `message_status` (para ver estado de envíos)

### 4. Probar
Envía un mensaje de WhatsApp al número `+1 201 927 4212`

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Status del servicio |
| GET | `/health` | Health check |
| GET | `/webhook` | Verificación de Meta |
| POST | `/webhook` | Recepción de mensajes |

## Desarrollo Local

```bash
# Instalar dependencias
npm install

# Crear archivo .env
cp .env.example .env
# Editar .env con tus credenciales

# Iniciar servidor
npm run dev
```

## Testing con curl

### Verificación de webhook:
```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=xcirculars_webhook_verify_2026&hub.challenge=1234567890"
```

Respuesta esperada: `1234567890`

### Simular mensaje entrante:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "TEST",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "12019274212",
            "phone_number_id": "981887568348921"
          },
          "contacts": [{"profile": {"name": "Test User"}}],
          "messages": [{
            "from": "5215512345678",
            "id": "test_msg_001",
            "timestamp": "1234567890",
            "type": "text",
            "text": {"body": "Hola, quiero saber el estado de mi circular"}
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

## Próximos Pasos

1. Conectar con Airtable para buscar clientes
2. Implementar lógica de intenciones (NLP)
3. Manejar templates de mensajes aprobados por Meta
4. Integrar con sistema de tickets de soporte

## Soporte

Para xcirculars - contactar a Johm
