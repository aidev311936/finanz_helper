import { createRouter, createWebHistory } from 'vue-router';
import Wizard from './components/Wizard.vue';
import Analysis from './components/Analysis.vue';

const routes = [
  { path: '/', component: Wizard },
  { path: '/analysis', component: Analysis }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;