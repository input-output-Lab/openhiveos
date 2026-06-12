<template>
  <transition-group
    name="toast"
    tag="div"
    class="io-toast-stack"
    aria-live="polite"
    aria-label="Notifications"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="io-toast"
      :class="`io-toast--${toast.type}`"
      role="alert"
    >
      <p class="io-toast__title">{{ toast.message }}</p>
      <button
        type="button"
        class="io-toast__dismiss"
        aria-label="Dismiss notification"
        @click="remove(toast.id)"
      >×</button>
    </div>
  </transition-group>
</template>

<script setup lang="ts">
import { useToast } from '../composables/useToast'
const { toasts, remove } = useToast()
</script>

<style scoped>
.io-toast-stack {
  position: fixed;
  bottom: var(--io-space-4);
  right: var(--io-space-4);
  z-index: var(--io-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--io-space-2);
  pointer-events: none;
  max-width: 320px;
}

.io-toast {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--io-space-3);
  padding: var(--io-space-3) var(--io-space-4);
  background-color: var(--io-surface-card-bg);
  color: var(--io-surface-text);
  border: 1px solid var(--io-surface-border);
  border-left-width: 3px;
  border-left-color: var(--io-accent-1);
  border-radius: var(--io-radius-md);
  box-shadow: var(--io-shadow-sm);
  pointer-events: auto;
}

.io-toast__title {
  margin: 0;
  font-family: var(--io-font-body);
  font-size: var(--io-text-sm);
  font-weight: var(--io-fw-semibold);
  line-height: 1.4;
}

.io-toast__dismiss {
  border: 0;
  background: transparent;
  color: var(--io-surface-text-muted);
  font-size: var(--io-text-lg);
  line-height: 1;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: color var(--io-transition-fast);
}
.io-toast__dismiss:hover   { color: var(--io-surface-text); }
.io-toast__dismiss:focus-visible {
  outline: none;
  box-shadow: var(--io-focus-ring);
  border-radius: var(--io-radius-sm);
}

.io-toast--success { border-left-color: var(--io-success); }
.io-toast--error   { border-left-color: var(--io-error); }
.io-toast--warning { border-left-color: var(--io-warning); }
.io-toast--info    { border-left-color: var(--io-info); }

.toast-enter-active { transition: all 0.2s ease; }
.toast-leave-active { transition: all 0.15s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(16px); }
</style>
