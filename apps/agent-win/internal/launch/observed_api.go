package launch

import (
	"context"
	"sync"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/request"
)

// observedAPI oturum firmasının adını (BINDING_LIMIT metni) ve kayıtla açılan talebin 201'ini (TouchBinding) izler.
type observedAPI struct {
	API
	mu     sync.Mutex
	tenant string
	touch  func(key string)
}

func (o *observedAPI) setTenant(name string) {
	o.mu.Lock()
	o.tenant = request.Display(name, "")
	o.mu.Unlock()
}

func (o *observedAPI) lastTenant() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.tenant
}

func (o *observedAPI) Resolve(ctx context.Context, code string) (*api.ResolveResult, error) {
	r, err := o.API.Resolve(ctx, code)
	if err == nil {
		o.setTenant(r.Tenant.Name)
	}
	return r, err
}

func (o *observedAPI) TenantInfo(ctx context.Context, ref string) (*api.TenantRequestInfo, error) {
	r, err := o.API.TenantInfo(ctx, ref)
	if err == nil {
		o.setTenant(r.Tenant.Name)
	}
	return r, err
}

func (o *observedAPI) BindingStatus(ctx context.Context, key string) (*api.BindingInfo, error) {
	r, err := o.API.BindingStatus(ctx, key)
	if err == nil {
		o.setTenant(r.Tenant.Name)
	}
	return r, err
}

func (o *observedAPI) CreateRequest(ctx context.Context, body api.CreateRequestBody) (*api.CreateRequestResult, error) {
	r, err := o.API.CreateRequest(ctx, body)
	if err == nil && body.BindingKey != "" && o.touch != nil {
		o.touch(body.BindingKey)
	}
	return r, err
}
