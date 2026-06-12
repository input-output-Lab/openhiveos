<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-[#14201E]">Edit Portfolio Matrix</h3>
      <button
        v-if="isEditing"
        type="button"
        class="text-xs text-[#14201E]/40 hover:text-[#14201E] transition-colors"
        @click="cancelEdit"
      >
        Cancel
      </button>
    </div>

    <!-- Form grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <!-- Business Value -->
      <div class="space-y-2">
        <label class="text-xs font-semibold uppercase tracking-wider text-[#14201E]/30">
          Business Value
        </label>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="val in [1, 3, 5]"
            :key="`bv-${val}`"
            type="button"
            :aria-pressed="form.business_value === val"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
            :class="form.business_value === val
              ? 'bg-[#14201E] text-white border-[#14201E]'
              : 'bg-white text-[#14201E] border-gray-200 hover:border-[#14201E]/30'"
            @click="form.business_value = val"
          >
            {{ val }}
          </button>
          <button
            v-if="form.business_value !== null"
            type="button"
            class="px-3 py-1.5 text-xs font-semibold text-[#14201E]/40 hover:text-[#14201E] transition-colors rounded-lg border border-gray-200 hover:border-gray-300"
            @click="form.business_value = null"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Strategic Fit -->
      <div class="space-y-2">
        <label class="text-xs font-semibold uppercase tracking-wider text-[#14201E]/30">
          Strategic Fit
        </label>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="val in [1, 3, 5]"
            :key="`sf-${val}`"
            type="button"
            :aria-pressed="form.strategic_fit === val"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
            :class="form.strategic_fit === val
              ? 'bg-[#14201E] text-white border-[#14201E]'
              : 'bg-white text-[#14201E] border-gray-200 hover:border-[#14201E]/30'"
            @click="form.strategic_fit = val"
          >
            {{ val }}
          </button>
          <button
            v-if="form.strategic_fit !== null"
            type="button"
            class="px-3 py-1.5 text-xs font-semibold text-[#14201E]/40 hover:text-[#14201E] transition-colors rounded-lg border border-gray-200 hover:border-gray-300"
            @click="form.strategic_fit = null"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Effort -->
      <div class="space-y-2">
        <label class="text-xs font-semibold uppercase tracking-wider text-[#14201E]/30">
          Effort
        </label>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="val in [1, 3, 5]"
            :key="`ef-${val}`"
            type="button"
            :aria-pressed="form.effort === val"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
            :class="form.effort === val
              ? 'bg-[#14201E] text-white border-[#14201E]'
              : 'bg-white text-[#14201E] border-gray-200 hover:border-[#14201E]/30'"
            @click="form.effort = val"
          >
            {{ val }}
          </button>
          <button
            v-if="form.effort !== null"
            type="button"
            class="px-3 py-1.5 text-xs font-semibold text-[#14201E]/40 hover:text-[#14201E] transition-colors rounded-lg border border-gray-200 hover:border-gray-300"
            @click="form.effort = null"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Risk Index -->
      <div class="space-y-2">
        <label class="text-xs font-semibold uppercase tracking-wider text-[#14201E]/30">
          Risk Index
        </label>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="val in [1, 3, 5]"
            :key="`ri-${val}`"
            type="button"
            :aria-pressed="form.risk_index === val"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
            :class="form.risk_index === val
              ? 'bg-[#14201E] text-white border-[#14201E]'
              : 'bg-white text-[#14201E] border-gray-200 hover:border-[#14201E]/30'"
            @click="form.risk_index = val"
          >
            {{ val }}
          </button>
          <button
            v-if="form.risk_index !== null"
            type="button"
            class="px-3 py-1.5 text-xs font-semibold text-[#14201E]/40 hover:text-[#14201E] transition-colors rounded-lg border border-gray-200 hover:border-gray-300"
            @click="form.risk_index = null"
          >
            Clear
          </button>
        </div>
      </div>
    </div>

    <!-- Error message -->
    <div v-if="submitError" class="p-3 bg-red-50 border border-red-200 rounded-lg">
      <p class="text-xs text-red-600">{{ submitError }}</p>
    </div>

    <!-- Submit button -->
    <div class="flex gap-3 pt-2">
      <button
        type="button"
        :disabled="isSubmitting || !hasChanges"
        class="px-4 py-2 text-xs font-semibold rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        :class="!isSubmitting && hasChanges
          ? 'bg-[#14201E] text-white border-[#14201E] hover:bg-[#14201E]/90'
          : 'bg-white text-[#14201E]/40 border-gray-200'"
        @click="submitForm"
      >
        <span v-if="isSubmitting" class="inline-flex items-center gap-2">
          <span class="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Saving…
        </span>
        <span v-else>Save Changes</span>
      </button>
      <button
        v-if="isEditing"
        type="button"
        class="px-4 py-2 text-xs font-semibold text-[#14201E]/40 hover:text-[#14201E] rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
        @click="cancelEdit"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { patchProject } from '../services/squadApi'
import type { ProjectDetail, PortfolioValue } from '../types/api'

interface Props {
  project: ProjectDetail
  onUpdate?: (updated: ProjectDetail) => void
}

const props = withDefaults(defineProps<Props>(), {})

// ─── Form state ───────────────────────────────────────────────────────────────

const form = ref({
  business_value: props.project.business_value as PortfolioValue,
  strategic_fit: props.project.strategic_fit as PortfolioValue,
  effort: props.project.effort as PortfolioValue,
  risk_index: props.project.risk_index as PortfolioValue,
})

const isEditing = ref(false)
const isSubmitting = ref(false)
const submitError = ref<string | null>(null)

// Track original values for comparison
const originalForm = ref({
  business_value: props.project.business_value as PortfolioValue,
  strategic_fit: props.project.strategic_fit as PortfolioValue,
  effort: props.project.effort as PortfolioValue,
  risk_index: props.project.risk_index as PortfolioValue,
})

// ─── Computed ─────────────────────────────────────────────────────────────────

const hasChanges = computed(() => {
  return (
    form.value.business_value !== originalForm.value.business_value ||
    form.value.strategic_fit !== originalForm.value.strategic_fit ||
    form.value.effort !== originalForm.value.effort ||
    form.value.risk_index !== originalForm.value.risk_index
  )
})

// ─── Methods ──────────────────────────────────────────────────────────────────

async function submitForm() {
  if (isSubmitting.value || !hasChanges.value) return

  isSubmitting.value = true
  submitError.value = null

  try {
    // Build update payload with only changed fields
    const updates: Record<string, PortfolioValue> = {}

    if (form.value.business_value !== originalForm.value.business_value) {
      updates.business_value = form.value.business_value
    }
    if (form.value.strategic_fit !== originalForm.value.strategic_fit) {
      updates.strategic_fit = form.value.strategic_fit
    }
    if (form.value.effort !== originalForm.value.effort) {
      updates.effort = form.value.effort
    }
    if (form.value.risk_index !== originalForm.value.risk_index) {
      updates.risk_index = form.value.risk_index
    }

    // Optimistically update the project
    const optimisticProject = { ...props.project, ...updates }

    // Call PATCH endpoint
    const response = await patchProject(props.project.slug, updates as any)

    // Update original values
    originalForm.value = { ...response.project }
    form.value = { ...response.project }

    // Notify parent of update
    props.onUpdate?.(response.project)

    // Reset editing state
    isEditing.value = false
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : 'Failed to save changes'
    // Revert optimistic changes
    form.value = { ...originalForm.value }
  } finally {
    isSubmitting.value = false
  }
}

function cancelEdit() {
  form.value = { ...originalForm.value }
  isEditing.value = false
  submitError.value = null
}

// ─── Watchers ────────────────────────────────────────────────────────────────

// Track when form becomes dirty (user starts editing)
watch(
  () => hasChanges.value,
  (changed) => {
    if (changed) {
      isEditing.value = true
    }
  },
)

// Update form when project prop changes
watch(
  () => props.project,
  (newProject) => {
    originalForm.value = {
      business_value: newProject.business_value as PortfolioValue,
      strategic_fit: newProject.strategic_fit as PortfolioValue,
      effort: newProject.effort as PortfolioValue,
      risk_index: newProject.risk_index as PortfolioValue,
    }
    form.value = { ...originalForm.value }
  },
  { deep: true },
)
</script>
