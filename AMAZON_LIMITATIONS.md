# Amazon limitations

Amazon is modeled as a retailer with additional conditions. A valid observation should preserve ASIN, URL/reference, seller, fulfilment, package count/size, one-time price, subscription price, coupon, shipping, Prime eligibility, delivery estimate, stock, timestamp, evidence, and confidence.

Basketra never assumes free shipping merely because the user has Prime. Shipping becomes zero only when current evidence explicitly confirms Prime free delivery or another applicable free-delivery condition.

Subscribe & Save, coupon-dependent prices, minimum basket requirements, third-party sellers, unavailable listings, and stale availability must remain visible. Current code normalizes provided Amazon-style offers but does not scrape or call Amazon.
