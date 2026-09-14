// =====================================================================
//  E-COMMERCE CART SYSTEM — Invengic Studio
//  Max 20 keychains total per cart. LocalStorage persistence.
// =====================================================================

(function () {
    const STORAGE_KEY = 'invengic_cart_v1';
    const MAX_CART_ITEMS_TOTAL = 20;

    class CartSystem {
        constructor() {
            this.items = [];
            this.editingItemId = null;
            this.listeners = [];
            this.loadCart();
        }

        loadCart() {
            try {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed)) {
                        this.items = parsed;
                    }
                }
            } catch (e) {
                console.warn('[CART] Failed to load cart from localStorage:', e);
                this.items = [];
            }
        }

        saveCart() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
            } catch (e) {
                console.warn('[CART] Failed to save cart to localStorage:', e);
            }
            this.notify();
        }

        subscribe(listener) {
            if (typeof listener === 'function') {
                this.listeners.push(listener);
            }
        }

        notify() {
            this.listeners.forEach(fn => fn(this));
        }

        getTotalCount() {
            return this.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 1), 0);
        }

        getSubtotal() {
            return this.items.reduce((sum, item) => sum + ((parseFloat(item.price) || 1) * (parseInt(item.quantity) || 1)), 0);
        }

        canAddQuantity(additionalCount = 1) {
            return (this.getTotalCount() + additionalCount) <= MAX_CART_ITEMS_TOTAL;
        }

        getItems() {
            return this.items;
        }

        getItem(itemId) {
            return this.items.find(i => i.id === itemId) || null;
        }

        getEditingItemId() {
            return this.editingItemId;
        }

        updateQuantity(itemId, targetQty) {
            const item = this.items.find(i => i.id === itemId);
            if (!item) return { success: false };

            const target = parseInt(targetQty, 10);
            if (isNaN(target)) return { success: false };

            const currentQty = parseInt(item.quantity) || 1;
            const diff = target - currentQty;

            if (diff > 0 && !this.canAddQuantity(diff)) {
                return {
                    success: false,
                    message: `You can add a maximum of ${MAX_CART_ITEMS_TOTAL} keychains per order.`
                };
            }

            if (target <= 0) {
                return this.removeItem(itemId);
            }

            item.quantity = target;
            this.saveCart();
            return { success: true };
        }

        addItem(customization) {
            const qty = parseInt(customization.quantity) || 1;
            if (!this.canAddQuantity(qty) && !this.editingItemId) {
                return {
                    success: false,
                    reason: 'limit_exceeded',
                    message: `You can add a maximum of ${MAX_CART_ITEMS_TOTAL} keychains per order.`
                };
            }

            const shape = customization.shape || customization.shapeId || 'rectangle';

            // If editing an existing cart item
            if (this.editingItemId || customization.id) {
                const targetId = this.editingItemId || customization.id;
                const index = this.items.findIndex(i => i.id === targetId);
                if (index !== -1) {
                    const existingQty = this.items[index].quantity || 1;
                    this.items[index] = {
                        ...this.items[index],
                        ...customization,
                        id: targetId,
                        shape: shape,
                        shapeId: shape,
                        unitPrice: 1,
                        price: 1,
                        quantity: existingQty
                    };
                    const updated = this.items[index];
                    this.editingItemId = null;
                    this.saveCart();
                    return { success: true, isEdit: true, item: updated };
                }
                this.editingItemId = null;
            }

            const newItem = {
                id: 'cart_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                productId: shape,
                mode: customization.mode || 'text',
                shape: shape,
                shapeId: shape,
                fontId: customization.fontId || 'pixel',
                name: customization.name || '',
                textPos: customization.textPos || null,
                printImageBase64: customization.printImageBase64 || null,
                imageProcessorState: customization.imageProcessorState || null,
                thumbUrl: customization.thumbUrl || null,
                price: customization.price || 1,
                unitPrice: customization.unitPrice || 1,
                quantity: qty,
                createdAt: Date.now()
            };

            this.items.push(newItem);
            this.saveCart();
            return { success: true, isEdit: false, item: newItem };
        }

        removeItem(itemId) {
            const index = this.items.findIndex(i => i.id === itemId);
            if (index !== -1) {
                const removed = this.items.splice(index, 1)[0];
                this.saveCart();
                return { success: true, removed };
            }
            return { success: false };
        }

        setEditingItem(itemId) {
            this.editingItemId = itemId;
        }

        clearEditingItem() {
            this.editingItemId = null;
        }

        getEditingItem() {
            if (!this.editingItemId) return null;
            return this.items.find(i => i.id === this.editingItemId) || null;
        }

        clearCart() {
            this.items = [];
            this.editingItemId = null;
            this.saveCart();
        }
    }

    window.InvengicCart = new CartSystem();
})();
