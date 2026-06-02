# Quiq Delivery And Feedback

Use this rule when `Chatot` owns the SMS execution and feedback lifecycle.

## Quiq Runtime Configuration

Use AWS Secrets Manager for Quiq credentials and pass the ARN into the runtime.

Required runtime settings:

- `QUIQ_SECRET_ARN`: ARN of the Secrets Manager secret for Quiq credentials
- `QUIQ_DLC_CONTACT_POINT`: contact point for DLC / long-code delivery
- `QUIQ_SHORTCODE_CONTACT_POINT`: contact point for shortcode delivery
- `QUIQ_DLC_PERCENTAGE`: percentage of messages routed to DLC when both contact points are enabled
- a product-owned correlation store or event store for send events and vendor ID mappings

Useful optional settings:

- `DISABLE_MMS_ASSETS`: set true to force SMS-only sends with no Quiq assets
- `REPLACE_MMS_ASSET`: set true to remap asset IDs before sending
- `FIX_CO_TO_COM`: optional URL rewrite toggle
- `ADD_ACCOUNT_ID_TO_LOGIN`: optional message rewrite that appends `account_id` to login URLs

The Quiq secret should be JSON with at least:

- `client_id`
- `client_secret`
- `base_url`

## Quiq API Invocation

Invoke Quiq with Basic Auth using `client_id` and `client_secret` from the secret.

HTTP request:

- method: `POST`
- URL: `{base_url}/api/v1/messaging/notify?allowMultipleSegments=true`
- headers:
  - `Content-type: application/json`
  - `Accept: application/json`

Payload shape:

```json
{
  "contactPoint": "<configured contact point>",
  "notifications": [
    {
      "searchInfo": {
        "phoneNumber": "<e164 phone number>",
        "searchId": "<message_id>"
      },
      "messageMap": {
        "default": {
          "text": "<rendered message>",
          "assets": []
        }
      }
    }
  ]
}
```

If MMS assets are enabled, include them under `messageMap.default.assets`.

## Response Handling

For every send:

- store the local `message_id`
- capture Quiq's returned message ID
- persist ID mappings and send events to the product-owned correlation layer
- treat unsuccessful response rows as failed sends with explicit error text

## Status Correlation

Quiq deliverability notifications identify the provider message, not the product's internal communication. Before writing a delivery status, the runtime must enrich the Quiq message id through its correlation layer to recover the internal communication or interaction identifier.

Keep this rule generic: Chatot defines the need for the correlation layer, but the runtime chooses the concrete store, indexes, retention policy, and resource names.

For every correlated status event, produce a normalized outcome containing at least:

- provider name
- provider message id
- internal communication or interaction id
- status
- status timestamp from the provider event
- source event id or source object reference when available

Publish normalized outcomes to EventBridge, or the product's equivalent engagement bus, when other services need asynchronous delivery facts. Persist the outcome to the product's internal source of truth, such as graph/Persist, before treating external reporting as complete.

Use an idempotency key based on the internal communication identifier, status, and provider status timestamp so repeated Quiq export rows or retried processing do not create duplicate lifecycle facts.

If a Quiq status event cannot be correlated or persisted, route it to retry/DLQ or pending-event handling with enough context to replay it.

## Feedback Loop

Capture and persist at least:

- accepted or rejected sends
- delivery status
- clicks or visits when linked back later
- PTPs and payments when linked back later
- opt-outs and complaints

Execution should close the activity state instead of remaining a fire-and-forget black box.
