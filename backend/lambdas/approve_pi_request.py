from pi_requests import approve_pi_request, handle_pi_request


def lambda_handler(event, context):
  return handle_pi_request(approve_pi_request, event)
