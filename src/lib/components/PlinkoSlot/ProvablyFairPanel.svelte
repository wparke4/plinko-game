<script lang="ts">
  import { verifyProvablyFair, recomputeCombinedSeed } from '$lib/utils/provablyFair';
  import Copy from 'phosphor-svelte/lib/Copy';
  import Check from 'phosphor-svelte/lib/Check';
  import ShieldCheck from 'phosphor-svelte/lib/ShieldCheck';
  
  interface Props {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    revealedServerSeed?: string;
    onClientSeedChange?: (seed: string) => void;
    onRotate?: () => void;
  }
  
  let { 
    serverSeedHash, 
    clientSeed, 
    nonce, 
    revealedServerSeed,
    onClientSeedChange,
    onRotate 
  }: Props = $props();
  
  let copiedField: string | null = $state(null);
  let newClientSeed = $state(clientSeed);
  let verificationResult = $state<boolean | null>(null);
  
  async function copyToClipboard(text: string, field: string) {
    await navigator.clipboard.writeText(text);
    copiedField = field;
    setTimeout(() => { copiedField = null; }, 2000);
  }
  
  function verifyServer() {
    if (revealedServerSeed) {
      verificationResult = verifyProvablyFair(revealedServerSeed, serverSeedHash);
    }
  }
  
  function updateClientSeed() {
    onClientSeedChange?.(newClientSeed);
  }
</script>

<div class="bg-neutral-900 border border-neutral-700 rounded-lg p-4 space-y-4">
  <div class="flex items-center gap-2 text-green-400 mb-2">
    <ShieldCheck class="w-5 h-5" />
    <span class="text-sm font-medium uppercase tracking-wide">Provably Fair</span>
  </div>

  <!-- Server Seed Hash -->
  <div>
    <label class="text-xs text-neutral-500 uppercase">Server Seed Hash (Commitment)</label>
    <div class="flex items-center gap-2 mt-1">
      <input
        type="text"
        value={serverSeedHash}
        readonly
        class="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-300 font-mono truncate"
      />
      <button
        onclick={() => copyToClipboard(serverSeedHash, 'hash')}
        class="p-2 bg-neutral-800 border border-neutral-700 rounded hover:bg-neutral-700 transition-colors"
      >
        {#if copiedField === 'hash'}
          <Check class="w-4 h-4 text-green-400" />
        {:else}
          <Copy class="w-4 h-4 text-neutral-400" />
        {/if}
      </button>
    </div>
  </div>

  <!-- Client Seed -->
  <div>
    <label class="text-xs text-neutral-500 uppercase">Client Seed</label>
    <div class="flex items-center gap-2 mt-1">
      <input
        type="text"
        bind:value={newClientSeed}
        class="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-white font-mono"
      />
      <button
        onclick={updateClientSeed}
        disabled={newClientSeed === clientSeed}
        class="px-3 py-2 bg-neutral-700 rounded text-sm text-white hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Update
      </button>
    </div>
  </div>

  <!-- Nonce -->
  <div>
    <label class="text-xs text-neutral-500 uppercase">Nonce</label>
    <div class="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-300 font-mono mt-1">
      {nonce}
    </div>
  </div>

  <!-- Revealed Server Seed (after rotation) -->
  {#if revealedServerSeed}
    <div class="border-t border-neutral-700 pt-4">
      <label class="text-xs text-neutral-500 uppercase">Revealed Server Seed</label>
      <div class="flex items-center gap-2 mt-1">
        <input
          type="text"
          value={revealedServerSeed}
          readonly
          class="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-green-300 font-mono truncate"
        />
        <button
          onclick={() => copyToClipboard(revealedServerSeed!, 'revealed')}
          class="p-2 bg-neutral-800 border border-neutral-700 rounded hover:bg-neutral-700 transition-colors"
        >
          {#if copiedField === 'revealed'}
            <Check class="w-4 h-4 text-green-400" />
          {:else}
            <Copy class="w-4 h-4 text-neutral-400" />
          {/if}
        </button>
      </div>
      
      <button
        onclick={verifyServer}
        class="mt-2 w-full py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-medium text-white transition-colors"
      >
        Verify Server Seed
      </button>
      
      {#if verificationResult !== null}
        <div class="mt-2 p-2 rounded text-sm text-center {verificationResult ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}">
          {verificationResult ? 'Verification Passed!' : 'Verification Failed!'}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Rotate Button -->
  <button
    onclick={onRotate}
    class="w-full py-2 bg-neutral-700 hover:bg-neutral-600 rounded text-sm font-medium text-white transition-colors"
  >
    Rotate Server Seed (Reveal Current)
  </button>
  
  <p class="text-xs text-neutral-500">
    The server seed is hashed before you play. After rotation, you can verify the revealed seed matches the hash commitment.
  </p>
</div>
