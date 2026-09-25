import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Linking, Modal, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import type { CheckoutSession, RazorpaySuccessPayload } from '../types/api';

export type CheckoutResult =
  | { type: 'success'; payload: RazorpaySuccessPayload }
  | { type: 'dismissed' }
  | { type: 'failed'; message: string };

interface RazorpayCheckoutProps {
  session: CheckoutSession | null;
  onResult: (result: CheckoutResult) => void;
}

/** Serialises data for inline <script> without allowing `</script>` breakouts. */
function toSafeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function buildCheckoutHtml(session: CheckoutSession): string {
  const options = {
    key: session.keyId,
    subscription_id: session.subscriptionId,
    name: session.plan.brandName,
    description: 'Premium — unlimited reels',
    prefill: {
      email: session.prefill.email ?? undefined,
      name: session.prefill.name ?? undefined,
    },
    notes: { source: 'edushorts-mobile' },
    theme: { color: '#7C3AED', backdrop_color: '#07060B' },
    retry: { enabled: true, max_count: 3 },
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>html,body{margin:0;height:100%;background:#07060B;}</style>
</head>
<body>
<script>
  (function () {
    function send(type, data) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data || null }));
    }
    function open() {
      try {
        var options = ${toSafeScriptJson(options)};
        options.handler = function (response) { send('success', response); };
        options.modal = {
          escape: false,
          confirm_close: true,
          ondismiss: function () { send('dismissed'); }
        };
        var rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (response) {
          send('failed', { description: (response && response.error && response.error.description) || 'Payment failed' });
        });
        rzp.open();
        send('opened');
      } catch (error) {
        send('fatal', { description: String((error && error.message) || error) });
      }
    }
    var script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = open;
    script.onerror = function () { send('fatal', { description: 'Could not load Razorpay Checkout. Check your connection.' }); };
    document.body.appendChild(script);
  })();
</script>
</body>
</html>`;
}

interface CheckoutMessage {
  /** failed = a payment attempt failed (Checkout stays open for retry); fatal = Checkout could not start. */
  type: 'opened' | 'success' | 'dismissed' | 'failed' | 'fatal';
  data: unknown;
}

function isSuccessPayload(value: unknown): value is RazorpaySuccessPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.razorpay_payment_id === 'string' &&
    typeof payload.razorpay_subscription_id === 'string' &&
    typeof payload.razorpay_signature === 'string'
  );
}

/**
 * Razorpay Standard Checkout (checkout.js) hosted in a WebView. Works in Expo
 * Go and dev builds alike; UPI intents (upi://, tez://, phonepe://, ...) are
 * handed to the OS so the user's UPI app can complete the mandate.
 */
export function RazorpayCheckout({ session, onResult }: RazorpayCheckoutProps) {
  const settled = useRef(false);
  const html = useMemo(() => (session ? buildCheckoutHtml(session) : ''), [session]);

  const finish = useCallback(
    (result: CheckoutResult) => {
      if (settled.current) return;
      settled.current = true;
      onResult(result);
    },
    [onResult],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: CheckoutMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as CheckoutMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'success':
          if (isSuccessPayload(message.data)) finish({ type: 'success', payload: message.data });
          else finish({ type: 'failed', message: 'Unexpected response from Razorpay' });
          break;
        case 'dismissed':
          finish({ type: 'dismissed' });
          break;
        case 'failed':
          // Razorpay keeps Checkout open so the user can retry another method.
          break;
        case 'fatal': {
          const description =
            typeof message.data === 'object' && message.data !== null && 'description' in message.data
              ? String((message.data as { description: unknown }).description)
              : 'Could not start the payment.';
          finish({ type: 'failed', message: description });
          break;
        }
        default:
          break;
      }
    },
    [finish],
  );

  const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    const { url } = request;
    if (/^(https?|about|data|blob):/i.test(url)) return true;
    // UPI / wallet app deep links.
    Linking.openURL(url).catch(() => {
      console.warn('No app available to handle', url);
    });
    return false;
  }, []);

  // Each new checkout session can report exactly one result.
  useEffect(() => {
    settled.current = false;
  }, [session?.subscriptionId]);

  return (
    <Modal
      visible={session !== null}
      animationType="slide"
      onRequestClose={() => finish({ type: 'dismissed' })}
    >
      <View className="flex-1 bg-ink-950">
        {session ? (
          <WebView
            originWhitelist={['*']}
            source={{ html, baseUrl: 'https://checkout.razorpay.com/' }}
            onMessage={handleMessage}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            startInLoadingState
            renderLoading={() => (
              <View className="absolute inset-0 items-center justify-center bg-ink-950">
                <ActivityIndicator size="large" color="#A78BFA" />
              </View>
            )}
            onError={() => finish({ type: 'failed', message: 'Could not open the payment page.' })}
            style={{ backgroundColor: '#07060B' }}
          />
        ) : null}
      </View>
    </Modal>
  );
}
