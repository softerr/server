# Config

1. Update packages

```
sudo apt update
sudo apt list --upgradable
sudo apt upgrade
```

2. Install apache2

```
sudo apt install apache2
```

3. Install php

```
sudo apt install php
```

4. Config website

    Place `000-default.conf` to `/etc/apache2/sites-available`
    Reload apache2

    ```
    systemctl reload apache2
    ```
