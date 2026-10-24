<?php
// Install as config/ops_bridge.php in the CRMEB application root (not public/).
return [
    'enabled' => false,
    'token' => '', // Generate a NEW secret with openssl rand -hex 32.
    'admin_id' => 0, // Use an existing platform admin ID for stock audit attribution.
    'image_hosts' => ['cbu01.alicdn.com', 'cbu02.alicdn.com', 'cbu03.alicdn.com', 'cbu04.alicdn.com'],
    // Exact OPS category text => existing CRMEB category ID (or full ID path).
    'category_map' => [
        // '家居 / 收纳' => [12, 34],
    ],
    // Drafts require a valid shipping template. Set the existing template ID.
    'shipping_template_id' => 0,
];
