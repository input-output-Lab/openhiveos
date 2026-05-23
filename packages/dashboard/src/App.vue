<template>
  <div class="flex h-[100dvh] bg-[#F6FBF7] text-[#14201E] overflow-hidden">
    <!-- Sidebar -->
    <AppSidebar :mobile-open="sidebarOpen" @close="sidebarOpen = false" />

    <!-- Main area — offset by sidebar width on lg+ -->
    <div class="flex flex-col flex-1 min-w-0 lg:ml-56">

      <!-- Mobile top bar -->
      <header class="lg:hidden flex items-center gap-4 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
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
          <RouterView v-slot="{ Component }">
            <Transition name="page" mode="out-in">
              <component :is="Component" :key="$route.path" />
            </Transition>
          </RouterView>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { RouterView } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'

const sidebarOpen = ref(false)
</script>
