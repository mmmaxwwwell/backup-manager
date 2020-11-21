# backup-manager
 
This docker container aims to provide a set of rotated local/cloud backups.

Default backup strategy:
* Take a backup every hour, and retain a rotating backup of the last 2 days locally.
* Retain a twice daily offsite backup for 30 days.

Optional backup strategy:
* Frequency, # of saves.