from pi_requests import add_pi, handle_pi_request


def lambda_handler(event, context):
  return handle_pi_request(add_pi, event)
