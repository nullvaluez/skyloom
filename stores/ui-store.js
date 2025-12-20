import { create } from 'zustand';

export const useUIStore = create((set, get) => ({
  // Sidebar visibility
  sidebarOpen: true,

  // Detail panel visibility
  detailPanelOpen: false,

  // Settings modal visibility
  settingsOpen: false,

  // Mobile filter sheet visibility
  mobileFiltersOpen: false,

  // Search focused state
  searchFocused: false,

  // Loading states
  isLoading: false,
  loadingMessage: '',

  // Error state
  error: null,

  // AR mode
  arModeOpen: false,

  // Actions
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  openSidebar: () => {
    set({ sidebarOpen: true });
  },

  closeSidebar: () => {
    set({ sidebarOpen: false });
  },

  toggleDetailPanel: () => {
    set((state) => ({ detailPanelOpen: !state.detailPanelOpen }));
  },

  openDetailPanel: () => {
    set({ detailPanelOpen: true });
  },

  closeDetailPanel: () => {
    set({ detailPanelOpen: false });
  },

  toggleSettings: () => {
    set((state) => ({ settingsOpen: !state.settingsOpen }));
  },

  openSettings: () => {
    set({ settingsOpen: true });
  },

  closeSettings: () => {
    set({ settingsOpen: false });
  },

  toggleMobileFilters: () => {
    set((state) => ({ mobileFiltersOpen: !state.mobileFiltersOpen }));
  },

  openMobileFilters: () => {
    set({ mobileFiltersOpen: true });
  },

  closeMobileFilters: () => {
    set({ mobileFiltersOpen: false });
  },

  setSearchFocused: (focused) => {
    set({ searchFocused: focused });
  },

  setLoading: (isLoading, message = '') => {
    set({ isLoading, loadingMessage: message });
  },

  setError: (error) => {
    set({ error });
  },

  clearError: () => {
    set({ error: null });
  },

  toggleARMode: () => {
    set((state) => ({ arModeOpen: !state.arModeOpen }));
  },

  openARMode: () => {
    set({ arModeOpen: true });
  },

  closeARMode: () => {
    set({ arModeOpen: false });
  },
}));
