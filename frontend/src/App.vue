<template>
  <div class="min-h-screen bg-gray-100 text-gray-800">
    <header class="p-4 bg-blue-600 text-white shadow">
      <h1 class="text-xl font-bold">Finanz Helper Wizard</h1>
    </header>
    <main class="p-4">
      <router-view></router-view>
    </main>
  </div>
</template>

<script setup>
// Nothing here yet
</script>

<style>
/* Minimal styling; when integrating Tailwind, remove this */
.bg-gray-100 {
  background-color: #f7fafc;
}
.bg-blue-600 {
  background-color: #2563eb;
}
.text-white {
  color: #ffffff;
}
.shadow {
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
</style>