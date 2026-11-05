<template>
  <!-- Login gate (S18-SEC-03 #2642): while unauthenticated, the shell is
       replaced by the login screen. Views never render API-less. -->
  <div v-if="!authenticated" class="min-h-[100dvh] flex items-center justify-center px-4" style="background-color: var(--io-app-bg); color: var(--io-dark);">
    <form
      class="w-full max-w-sm rounded-2xl p-8 shadow-sm"
      style="background-color: var(--io-surface-card-bg); border: 1px solid var(--io-surface-border);"
      @submit.prevent="login"
    >
      <h1 class="text-xl font-bold mb-1">OpenHiveOS</h1>
      <p class="text-sm opacity-70 mb-6">Sign in to view the squad.</p>

      <label for="oh-login-password" class="block text-sm font-medium mb-2">Password</label>
      <input
        id="oh-login-password"
        ref="passwordInput"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        class="w-full rounded-lg px-3 py-2 mb-1 outline-none"
        style="border: 1px solid var(--io-surface-border); background: var(--io-surface-card-bg);"
        :disabled="loginState === 'busy' || loginState === 'disabled'"
      />
      <p v-if="loginMessage" class="text-sm mb-3" :style="{ color: loginState === 'error' ? '#b91c1c' : 'inherit' }" role="alert">
        {{ loginMessage }}
      </p>
      <button
        type="submit"
        class="w-full rounded-lg px-4 py-2 font-semibold transition-opacity disabled:opacity-50"
        style="background-color: var(--io-accent, #1a7f5a); color: #fff;"
        :disabled="loginState === 'busy' || loginState === 'disabled'"
      >
        {{ loginState === 'busy' ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </div>

  <!-- Authenticated app shell -->
  <div v-else class="flex h-[100dvh] overflow-hidden" style="background-color: var(--io-app-bg); color: var(--io-dark);">
    <!-- Sidebar -->
    <AppSidebar :mobile-open="sidebarOpen" @close="sidebarOpen = false" />

    <!-- Main area — offset by sidebar width on lg+ -->
    <div class="flex flex-col flex-1 min-w-0 lg:ml-56">

      <!-- Mobile top bar -->
      <header class="lg:hidden flex items-center gap-4 px-4 py-3 flex-shrink-0" style="background-color: var(--io-surface-card-bg); border-bottom: 1px solid var(--io-surface-border);">
        <button
          class="p-2 rounded-lg text-[#14201E]/50 hover:bg-gray-100 transition-colors"
          aria-label="Open navigation"
          @click="sidebarOpen = true"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span class="font-bold text-sm text-[#14201E]">OpenHiveOS</span>
      </header>

      <!-- Scrollable content -->
      <main class="flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div class="max-w-5xl mx-auto">
          <RouterView :key="$route.path" />
        </div>
      </main>
    </div>

    <!-- Toast notifications -->
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { RouterView } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import ToastContainer from './components/ToastContainer.vue'

type LoginState = 'checking' | 'ready' | 'busy' | 'error' | 'disabled'

const authenticated = ref(false)
const loginState = ref<LoginState>('checking')
const loginMessage = ref('')
const password = ref('')
const passwordInput = ref<HTMLInputElement | null>(null)
const sidebarOpen = ref(false)

/** Any 401 from squadApi flips the shell back to the login gate. */
function onUnauthorized(): void {
  authenticated.value = false
  loginState.value = 'ready'
  loginMessage.value = 'Session expired. Sign in again.'
  password.value = ''
}

async function probeSession(): Promise<void> {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include' })
    if (res.ok) {
      authenticated.value = true
      return
    }
    // 503 → auth not configured (no DASHBOARD_PASSWORD). Bearer-only
    // server flows are unaffected; tell the human why there is no login.
    if (res.status === 503) {
      loginState.value = 'disabled'
      loginMessage.value = 'Dashboard login is not configured on this server.'
      return
    }
    loginState.value = 'ready'
    passwordInput.value?.focus()
  } catch {
    loginState.value = 'error'
    loginMessage.value = 'Unable to reach OpenHiveOS squad-api.'
  }
}

async function login(): Promise<void> {
  if (!password.value) return
  loginState.value = 'busy'
  loginMessage.value = ''
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    })
    if (res.status === 204) {
      authenticated.value = true
      password.value = ''
      return
    }
    if (res.status === 503) {
      loginState.value = 'disabled'
      loginMessage.value = 'Dashboard login is not configured on this server.'
      return
    }
    loginState.value = 'error'
    loginMessage.value = 'Incorrect password.'
  } catch {
    loginState.value = 'error'
    loginMessage.value = 'Unable to reach OpenHiveOS squad-api.'
  }
}

onMounted(() => {
  window.addEventListener('squadapi:unauthorized', onUnauthorized)
  void probeSession()
})

onBeforeUnmount(() => {
  window.removeEventListener('squadapi:unauthorized', onUnauthorized)
})
</script>
