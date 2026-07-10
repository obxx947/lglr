<script setup lang="ts">
import HeroSection from './components/HeroSection.vue'
import FeaturesSection from './components/FeaturesSection.vue'
</script>

<template>
  <HeroSection />
  <FeaturesSection />
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter','Microsoft YaHei','PingFang SC',sans-serif;background:#0a0a0c;color:#fff;overflow-x:hidden}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0a0a0c}::-webkit-scrollbar-thumb{background:#2d4a6f;border-radius:2px}
</style>
