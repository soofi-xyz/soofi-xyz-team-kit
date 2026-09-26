---
title: Self-Resolving DLQ Channel Alarms
impact: HIGH
tags: cloudwatch, alarms, dlq, sqs, sns, notifications, channels, monitoring, observability, self-resolving, alarm-fatigue
---

## Self-Resolving DLQ Channel Alarms

This is the standard pattern for **monitoring and notifying through channels**. A
single CloudWatch alarm on DLQ depth is the source of truth, and it fans out to
every channel the team watches — email, chat (Slack / Teams via AWS Chatbot), and
**PagerDuty**. This rule and `observability-pagerduty-alerting` work **together**:
PagerDuty is one of the channels the alarm drives, not a separate mechanism.

Whenever a service routes failed items to a **dead-letter queue (DLQ)**, it MUST
attach **exactly one stateful CloudWatch alarm** on the DLQ depth that notifies
its channels when the DLQ is non-empty and **resolves itself** when the DLQ is
drained. Do NOT emit one notification per failed item, and do NOT build an alarm
that cannot return to `OK`.

### Required Lifecycle

The alarm MUST follow this self-resolving lifecycle:

1. Items land in the DLQ (a failure path filled it).
2. The alarm transitions `OK → ALARM` and sends **one** notification to every
   channel — including triggering a single PagerDuty incident.
3. A human triages and acts on the failed items.
4. The human drains the DLQ (redrive or consume + delete the messages).
5. The DLQ depth returns to `0`, the alarm transitions `ALARM → OK`, the alarm
   clears itself, and the PagerDuty incident auto-resolves — no manual reset.
6. The next time items land in the DLQ, the alarm transitions `OK → ALARM`
   again and notifies every channel again (a fresh PagerDuty incident).

### Why a Single Stateful Alarm

A CloudWatch alarm invokes its actions **only on state transitions**, not on
every breaching datapoint. While the DLQ stays non-empty the alarm stays in
`ALARM` and sends **nothing further** — so a queue with one failed item and a
queue with a million failed items both produce exactly one notification. This is
the entire point: it prevents thousands of duplicate alerts, keeps one live
signal per DLQ, and preserves the team's sense of urgency. Per-item
notifications (publishing to SNS for every poisoned message) destroy that signal
and train people to ignore the channel.

### How To Build It

- **Metric:** `ApproximateNumberOfMessagesVisible` on the DLQ (`AWS/SQS`), using
  the `Maximum` statistic so any non-empty datapoint trips the alarm.
- **Threshold:** `> 0`, `evaluationPeriods: 1`, `datapointsToAlarm: 1`.
- **Self-resolve:** `treatMissingData: NOT_BREACHING` so an idle/empty queue
  reports clear and the alarm returns to `OK`.
- **Channels:** point both the `ALARM` and `OK` transitions at one SNS topic that
  fans out to every channel — email, AWS Chatbot (Slack/Teams), and **PagerDuty**.
  Subscribe PagerDuty's CloudWatch integration URL to that topic; PagerDuty maps
  `ALARM → trigger` and `OK → resolve`, so the incident self-resolves on drain and
  re-triggers next time — the same lifecycle as every other channel. Add the
  PagerDuty subscription only in the production account.
- **Single alarm:** one alarm per DLQ. Do not also publish per-message alerts
  from the consumer, and do not POST PagerDuty triggers per failed message.

### ✅ Correct

```typescript
import { Duration } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';

const dlq = new sqs.Queue(this, 'OrderDlq', { retentionPeriod: Duration.days(14) });

// One channel topic that fans out to EVERY channel we watch — including PagerDuty.
const channelTopic = new sns.Topic(this, 'OrderDlqAlerts');
channelTopic.addSubscription(new subs.EmailSubscription('oncall-ops@example.com'));
if (isProduction) {
  // PagerDuty is just another channel: its CloudWatch integration URL maps
  // ALARM -> trigger and OK -> resolve, so incidents self-resolve with the alarm.
  channelTopic.addSubscription(
    new subs.UrlSubscription(pagerDutyCloudWatchIntegrationUrl, {
      protocol: sns.SubscriptionProtocol.HTTPS,
    }),
  );
}

// ONE stateful alarm per DLQ: notifies on OK -> ALARM, self-resolves on ALARM -> OK.
const dlqAlarm = new cloudwatch.Alarm(this, 'OrderDlqNotEmpty', {
  alarmName: 'order-service-dlq-not-empty',
  alarmDescription: 'Order DLQ has messages — triage and drain it; this alarm self-resolves.',
  metric: dlq.metricApproximateNumberOfMessagesVisible({
    period: Duration.minutes(1),
    statistic: 'Maximum',
  }),
  threshold: 0,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, // empty queue clears the alarm
});

dlqAlarm.addAlarmAction(new cwActions.SnsAction(channelTopic)); // fired once: notify + page
dlqAlarm.addOkAction(new cwActions.SnsAction(channelTopic));    // fired once: clear + auto-resolve PagerDuty
```

### ❌ Incorrect

```typescript
// Per-message notification: one alert (or one PagerDuty trigger) for every
// poisoned item. A burst of failures floods every channel with thousands of
// duplicates and nothing self-resolves.
export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    try {
      await process(record);
    } catch (error) {
      await sns.send(new PublishCommand({ TopicArn, Message: `DLQ item: ${record.messageId}` }));
      await triggerPagerDutyAlert({ summary: `DLQ item ${record.messageId}` }); // ❌ paging per item
    }
  }
};
```

```typescript
// Alarm that can never resolve: missing data is treated as breaching and there
// is no OK action. The alarm sticks in ALARM forever, the PagerDuty incident
// never auto-resolves, and a later batch of failures produces NO new
// OK -> ALARM transition — so it never re-notifies on any channel.
new cloudwatch.Alarm(this, 'OrderDlqNotEmpty', {
  metric: dlq.metricApproximateNumberOfMessagesVisible({ statistic: 'Maximum' }),
  threshold: 0,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.BREACHING, // ❌ never returns to OK
  // ❌ no addOkAction — channels never see the drain, the PagerDuty incident stays open
});
```

### Working With PagerDuty

PagerDuty is **one of the channels this alarm drives**, not a parallel system.
The CloudWatch alarm state is the single source of truth and every channel —
email, chat, and PagerDuty — follows it:

- `OK → ALARM` triggers a single PagerDuty incident (and notifies email/chat).
- `ALARM → OK` resolves that PagerDuty incident automatically — no manual close.
- A later batch of failures re-triggers a fresh incident.

This keeps the self-resolving, single-signal behavior consistent across every
channel and avoids duplicate or perpetually-open incidents. Use
`observability-pagerduty-alerting` for the broader paging contract (which
failures page on-call, production gating, secret handling); for DLQ /
queue-depth signals, drive PagerDuty from this alarm rather than POSTing a
trigger per failed message — per-message POSTs reintroduce the alarm storm this
pattern exists to prevent.

### References

- [CloudWatch alarm states and state transitions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
- [How CloudWatch alarms treat missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarms-and-missing-data)
- [Amazon SQS available CloudWatch metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [AWS Chatbot — CloudWatch alarm notifications to Slack/Teams](https://docs.aws.amazon.com/chatbot/latest/adminguide/setting-up.html)
- [PagerDuty — Amazon CloudWatch integration (auto trigger/resolve)](https://support.pagerduty.com/main/docs/aws-cloudwatch-integration-guide)
- [CDK — aws-cloudwatch Alarm](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html)
