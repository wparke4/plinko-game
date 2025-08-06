<script lang="ts">
  import { writable } from 'svelte/store';
  
  export let plinkoEngine: any = null; // Will receive the PlinkoEngine instance
  
  let isMuted = writable(false);
  
  function toggleMute() {
    if (plinkoEngine) {
      plinkoEngine.toggleAudioMute();
      isMuted.update(muted => !muted);
    }
  }
</script>

<div class="audio-controls">
  <button 
    class="mute-button"
    class:muted={$isMuted}
    on:click={toggleMute}
    title={$isMuted ? 'Unmute audio' : 'Mute audio'}
  >
    {#if $isMuted}
      🔇
    {:else}
      🔊
    {/if}
  </button>
</div>

<style>
  .audio-controls {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
  }
  
  .mute-button {
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #A3E635;
    border-radius: 8px;
    color: white;
    font-size: 20px;
    padding: 8px 12px;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .mute-button:hover {
    background: rgba(0, 0, 0, 0.9);
    border-color: #84CC16;
    transform: scale(1.05);
  }
  
  .mute-button.muted {
    border-color: #EF4444;
    opacity: 0.7;
  }
  
  .mute-button.muted:hover {
    border-color: #DC2626;
  }
</style> 