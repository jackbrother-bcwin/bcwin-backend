# WebSocket Implementation Guide for Frontend

## Overview

This document explains how to implement WebSocket communication in the frontend application. The backend uses a pub/sub architecture with Redis for cross-replica communication, allowing real-time updates across multiple server instances.

## Connection Setup

### 1. WebSocket Endpoint

```
ws://your-domain.com/ws?id={UUID}
```

**Required Query Parameter:**
- `id`: A UUID v4 that uniquely identifies the client connection. Generate this on the frontend using `crypto.randomUUID()` or a UUID library.

### 2. Authentication

Authentication is handled via HTTP cookies:
- Cookie Name: `AUTH_COOKIE_NAME` (check with backend team for exact name)
- The backend automatically extracts the JWT from the cookie during WebSocket upgrade
- Authenticated connections have access to protected topics
- Guest connections (no cookie) can only access public topics

**Important:** The WebSocket connection will upgrade successfully regardless of authentication status. However, subscribing to protected topics will fail without valid authentication.

### 3. Connection Lifecycle

```typescript
// Generate unique client ID
const clientId = crypto.randomUUID();

// Create WebSocket connection
const ws = new WebSocket(`ws://your-domain.com/ws?id=${clientId}`);

ws.onopen = () => {
  console.log('WebSocket connected');
  // Start subscribing to topics
};

ws.onmessage = (event) => {
  handleMessage(event.data);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
  console.log('WebSocket closed:', event.code, event.reason);
  // Implement reconnection logic
};
```

## Available Topics

### Public Topics (No Authentication Required)

| Topic | Description | Data Type |
|-------|-------------|-----------|
| `wingo-period-creation` | New Wingo game period created | Period creation data |
| `wingo-results` | Wingo game results | Number, color, size |
| `5d-period-creation` | New 5D game period created | Period creation data |
| `5d-results` | 5D game results | 5-digit result with sum |
| `k3-period-creation` | New K3 game period created | Period creation data |
| `k3-results` | K3 dice game results | 3 dice values with patterns |
| `moto-period-creation` | New Moto game period created | Period creation data |
| `moto-results` | Moto race results | Top 3 positions |
| `trx-wingo-period-creation` | New TRX Wingo period created | Period creation data |
| `trx-wingo-results` | TRX Wingo game results | Number, color, size |

### Protected Topics (Authentication Required)

| Topic | Description | Required Role |
|-------|-------------|---------------|
| `account-balance` | User account balance updates | Authenticated User |

### Admin Topics (Admin Role Required)

| Topic | Description |
|-------|-------------|
| `admin-wingo-bets` | Real-time Wingo bet notifications |
| `admin-5d-bets` | Real-time 5D bet notifications |
| `admin-k3-bets` | Real-time K3 bet notifications |
| `admin-moto-bets` | Real-time Moto bet notifications |
| `admin-trx-wingo-bets` | Real-time TRX Wingo bet notifications |

## Message Protocol

### Client → Server Messages

#### Subscribe to Topic

```json
{
  "action": "subscribe",
  "topic": "wingo-results"
}
```

#### Unsubscribe from Topic

```json
{
  "action": "unsubscribe",
  "topic": "wingo-results"
}
```

#### Ping/Pong (Heartbeat)

```
Send: "ping"
Receive: "pong"
```

### Server → Client Messages

#### Success Response

```json
{
  "success": true,
  "data": {
    "message": "Subscribed to topic",
    "topic": "wingo-results"
  }
}
```

#### Error Response

```json
{
  "success": false,
  "error": "Authentication required to subscribe to 'account-balance'"
}
```

#### Topic Data Message

```json
{
  "topic": "wingo-results",
  "data": {
    "periodId": "uuid",
    "periodNumber": "20231220001",
    "number": 5,
    "color": "GREEN",
    "size": "BIG"
  }
}
```

## Data Structures

### Period Creation Message

```typescript
interface PeriodCreationMessage {
  periodId: string;
  periodNumber: string;
  durationSeconds: number;
  startTime: string; // ISO 8601 date
  endTime: string;   // ISO 8601 date
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}
```

### Wingo/TRX-Wingo Results

```typescript
interface WingoResults {
  periodId: string;
  periodNumber: string;
  number: number;        // 0-9
  color: 'RED' | 'GREEN' | 'VIOLET';
  size: 'BIG' | 'SMALL';
}
```

### 5D Results

```typescript
interface FiveDResults {
  periodId: string;
  periodNumber: string;
  resultNumber: string;  // e.g., "12345"
  resultDigitA: number;  // 0-9
  resultDigitB: number;
  resultDigitC: number;
  resultDigitD: number;
  resultDigitE: number;
  resultSum: number;     // Sum of all digits
}
```

### K3 Results

```typescript
interface K3Results {
  periodId: string;
  periodNumber: string;
  dice1: number;         // 1-6
  dice2: number;
  dice3: number;
  sum: number;           // 3-18
  isTriple: boolean;     // All three same
  isDouble: boolean;     // Two same
  isAllDifferent: boolean;
  isConsecutive: boolean;
  isBig: boolean;        // sum >= 11
  isSmall: boolean;      // sum <= 10
  isOdd: boolean;
  isEven: boolean;
}
```

### Moto Results

```typescript
interface MotoResults {
  periodId: string;
  periodNumber: string;
  firstPlace: number;    // 1-10
  secondPlace: number;
  thirdPlace: number;
}
```

### Account Balance

```typescript
interface AccountBalance {
  balance: number;       // User's current balance
}
```

### Admin Bet Message

```typescript
interface AdminBetMessage {
  betId: string;
  userId: string;
  periodId: string;
  periodNumber: string;
  betAmount: number;
  betStatus: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED';
}
```

## Implementation Best Practices

### 1. Subscribe Only When Needed

Subscribe to topics only when the user is viewing the relevant page/component. This reduces server load and unnecessary data transfer.

```typescript
class WebSocketService {
  private ws: WebSocket | null = null;
  private subscriptions = new Set<string>();

  subscribe(topic: string) {
    if (this.subscriptions.has(topic)) {
      return; // Already subscribed
    }

    this.send({
      action: 'subscribe',
      topic: topic
    });

    this.subscriptions.add(topic);
  }

  unsubscribe(topic: string) {
    if (!this.subscriptions.has(topic)) {
      return; // Not subscribed
    }

    this.send({
      action: 'unsubscribe',
      topic: topic
    });

    this.subscriptions.remove(topic);
  }

  private send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
```

### 2. Component Lifecycle Integration

#### React Example

```typescript
function WingoGame() {
  const { subscribe, unsubscribe } = useWebSocket();

  useEffect(() => {
    // Subscribe when component mounts
    subscribe('wingo-period-creation');
    subscribe('wingo-results');

    // Unsubscribe when component unmounts
    return () => {
      unsubscribe('wingo-period-creation');
      unsubscribe('wingo-results');
    };
  }, [subscribe, unsubscribe]);

  // Component logic...
}
```

#### Vue Example

```typescript
export default {
  mounted() {
    this.$ws.subscribe('wingo-period-creation');
    this.$ws.subscribe('wingo-results');
  },
  beforeUnmount() {
    this.$ws.unsubscribe('wingo-period-creation');
    this.$ws.unsubscribe('wingo-results');
  }
}
```

### 3. Automatic Reconnection

Implement exponential backoff for reconnection attempts:

```typescript
class WebSocketService {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second

  connect() {
    this.ws = new WebSocket(`ws://domain.com/ws?id=${this.clientId}`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.resubscribeAll(); // Re-subscribe to all previous topics
    };

    this.ws.onclose = () => {
      this.attemptReconnect();
    };
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    setTimeout(() => {
      console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.connect();
    }, delay);
  }

  private resubscribeAll() {
    // Re-subscribe to all topics that were active before disconnect
    this.subscriptions.forEach(topic => {
      this.send({ action: 'subscribe', topic });
    });
  }
}
```

### 4. Message Handler

```typescript
class WebSocketService {
  private messageHandlers = new Map<string, Set<(data: any) => void>>();

  onMessage(topic: string, handler: (data: any) => void) {
    if (!this.messageHandlers.has(topic)) {
      this.messageHandlers.set(topic, new Set());
    }
    this.messageHandlers.get(topic)!.add(handler);
  }

  offMessage(topic: string, handler: (data: any) => void) {
    this.messageHandlers.get(topic)?.delete(handler);
  }

  private handleIncomingMessage(rawMessage: string) {
    try {
      const message = JSON.parse(rawMessage);

      // Handle response messages
      if ('success' in message) {
        if (!message.success) {
          console.error('WebSocket error:', message.error);
        }
        return;
      }

      // Handle topic data messages
      if (message.topic && message.data) {
        const handlers = this.messageHandlers.get(message.topic);
        if (handlers) {
          handlers.forEach(handler => handler(message.data));
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }
}
```

### 5. Heartbeat/Ping Implementation

Keep the connection alive with periodic pings:

```typescript
class WebSocketService {
  private pingInterval: number | null = null;
  private readonly PING_INTERVAL = 30000; // 30 seconds

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, this.PING_INTERVAL);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
```

### 6. Handle Protected Topics

```typescript
class WebSocketService {
  private isAuthenticated = false;

  setAuthenticated(authenticated: boolean) {
    this.isAuthenticated = authenticated;
  }

  subscribe(topic: string) {
    const protectedTopics = ['account-balance'];
    const adminTopics = [
      'admin-wingo-bets',
      'admin-5d-bets',
      'admin-k3-bets',
      'admin-moto-bets',
      'admin-trx-wingo-bets'
    ];

    if (!this.isAuthenticated && 
        (protectedTopics.includes(topic) || adminTopics.includes(topic))) {
      console.warn(`Cannot subscribe to ${topic}: authentication required`);
      return;
    }

    // Proceed with subscription...
  }
}
```

## Complete Example Implementation

```typescript
// websocket.service.ts
class WebSocketService {
  private ws: WebSocket | null = null;
  private clientId: string;
  private subscriptions = new Set<string>();
  private messageHandlers = new Map<string, Set<(data: any) => void>>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pingInterval: number | null = null;

  constructor(private baseUrl: string) {
    this.clientId = crypto.randomUUID();
  }

  connect() {
    this.ws = new WebSocket(`${this.baseUrl}/ws?id=${this.clientId}`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.startPing();
      this.resubscribeAll();
    };

    this.ws.onmessage = (event) => {
      if (event.data === 'pong') return;
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
      this.stopPing();
      this.attemptReconnect();
    };
  }

  disconnect() {
    this.maxReconnectAttempts = 0; // Prevent reconnection
    this.stopPing();
    this.ws?.close();
  }

  subscribe(topic: string) {
    if (this.subscriptions.has(topic)) return;

    this.send({ action: 'subscribe', topic });
    this.subscriptions.add(topic);
  }

  unsubscribe(topic: string) {
    if (!this.subscriptions.has(topic)) return;

    this.send({ action: 'unsubscribe', topic });
    this.subscriptions.delete(topic);
  }

  onMessage(topic: string, handler: (data: any) => void) {
    if (!this.messageHandlers.has(topic)) {
      this.messageHandlers.set(topic, new Set());
    }
    this.messageHandlers.get(topic)!.add(handler);
  }

  offMessage(topic: string, handler: (data: any) => void) {
    this.messageHandlers.get(topic)?.delete(handler);
  }

  private send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(rawMessage: string) {
    try {
      const message = JSON.parse(rawMessage);

      if ('success' in message) {
        if (!message.success) {
          console.error('WebSocket error:', message.error);
        }
        return;
      }

      if (message.topic && message.data) {
        const handlers = this.messageHandlers.get(message.topic);
        handlers?.forEach(handler => handler(message.data));
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  private resubscribeAll() {
    this.subscriptions.forEach(topic => {
      this.send({ action: 'subscribe', topic });
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

    setTimeout(() => {
      console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.connect();
    }, delay);
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

// Usage example
const wsService = new WebSocketService('ws://your-domain.com');
wsService.connect();

// Subscribe to topics
wsService.subscribe('wingo-results');

// Listen for messages
wsService.onMessage('wingo-results', (data) => {
  console.log('Wingo result:', data);
  // Update UI with result
});

// Clean up when done
wsService.unsubscribe('wingo-results');
wsService.disconnect();
```

## Testing Checklist

- [ ] Connection establishes successfully with valid UUID
- [ ] Connection fails gracefully with invalid/missing UUID
- [ ] Authenticated users can subscribe to protected topics
- [ ] Unauthenticated users receive error when subscribing to protected topics
- [ ] Subscriptions persist across page navigation (if needed)
- [ ] Unsubscribe works correctly and stops receiving messages
- [ ] Reconnection works after network interruption
- [ ] Ping/pong keeps connection alive
- [ ] Multiple subscriptions to same topic are handled correctly
- [ ] Memory leaks are prevented (handlers cleaned up)
- [ ] Error messages are displayed to user appropriately

## Common Pitfalls

1. **Forgetting to unsubscribe**: Always unsubscribe when component unmounts to prevent memory leaks and unnecessary server load.

2. **Not handling reconnection**: Network interruptions are common. Always implement reconnection logic.

3. **Subscribing multiple times**: Check if already subscribed before sending subscribe message.

4. **Not validating messages**: Always validate and handle unexpected message formats gracefully.

5. **Blocking UI on WebSocket messages**: Use debouncing/throttling for high-frequency updates.

6. **Hard-coding topics**: Use constants/enums for topic names to prevent typos.

## Support

For questions or issues, contact the backend team or refer to:
- WebSocket Manager: `/packages/websocket/index.ts`
- WebSocket Routes: `/apps/api/src/routes/websocket.ts`
- WebSocket Middleware: `/apps/api/src/middleware/websocket.ts`

